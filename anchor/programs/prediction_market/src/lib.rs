use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

mod errors;
mod state;

// Tests temporarily disabled - see tests.rs for LiteSVM tests
// #[cfg(test)]
// mod tests;

use errors::MarketError;
use state::{Market, UserPosition, MAX_QUESTION_LEN};

const PRICE_TIMESTAMP_TOLERANCE_SECONDS: i64 = 30;
const RESOLVE_GRACE_PERIOD_SECONDS: i64 = 30 * 60;

declare_id!("DYy72hMhhyHvbPjy71pp4137U4FumNuzM6i3mLVU2MWk");

#[program]
pub mod prediction_market {
    use super::*;

    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        question: String,
        resolution_time: i64,
        feed_id: [u8; 32],
        target_price: i64,
    ) -> Result<()> {
        require!(question.len() <= MAX_QUESTION_LEN, MarketError::Overflow);
        require!(target_price > 0, MarketError::InvalidTargetPrice);

        let clock = Clock::get()?;
        require!(
            resolution_time > clock.unix_timestamp,
            MarketError::ResolutionTimeInPast
        );

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.market_id = market_id;
        market.question = question;
        market.resolution_time = resolution_time;
        market.feed_id = feed_id;
        market.target_price = target_price;
        market.yes_pool = 0;
        market.no_pool = 0;
        market.resolved = false;
        market.outcome = None;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    pub fn place_bet(ctx: Context<PlaceBet>, amount: u64, bet_yes: bool) -> Result<()> {
        require!(amount > 0, MarketError::InvalidBetAmount);

        let clock = Clock::get()?;
        let market = &ctx.accounts.market;
        require!(
            clock.unix_timestamp < market.resolution_time,
            MarketError::BettingClosed
        );

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            amount,
        )?;

        let market = &mut ctx.accounts.market;
        if bet_yes {
            market.yes_pool = market.yes_pool.checked_add(amount).ok_or(MarketError::Overflow)?;
        } else {
            market.no_pool = market.no_pool.checked_add(amount).ok_or(MarketError::Overflow)?;
        }

        let position = &mut ctx.accounts.user_position;
        if position.market == Pubkey::default() {
            position.market = market.key();
            position.user = ctx.accounts.user.key();
            let (_, bump) = Pubkey::find_program_address(
                &[b"position", market.key().as_ref(), ctx.accounts.user.key().as_ref()],
                ctx.program_id,
            );
            position.bump = bump;
        }

        if bet_yes {
            position.yes_amount = position
                .yes_amount
                .checked_add(amount)
                .ok_or(MarketError::Overflow)?;
        } else {
            position.no_amount = position
                .no_amount
                .checked_add(amount)
                .ok_or(MarketError::Overflow)?;
        }

        Ok(())
    }

    /// Permissionless resolve: anyone can trigger after deadline.
    /// Outcome is determined automatically by comparing the Pyth price
    /// against the market's target_price.
    pub fn resolve_market(ctx: Context<ResolveMarket>) -> Result<()> {
        let clock = Clock::get()?;
        let market = &ctx.accounts.market;

        require!(
            clock.unix_timestamp >= market.resolution_time,
            MarketError::ResolutionTooEarly
        );
        require!(!market.resolved, MarketError::AlreadyResolved);
        require!(
            clock.unix_timestamp <= market.resolution_time + RESOLVE_GRACE_PERIOD_SECONDS,
            MarketError::ResolveWindowClosed
        );

        let price_update = &ctx.accounts.price_update;
        let price = price_update.get_price_unchecked(&market.feed_id)?;
        let publish_time_delta = (price.publish_time - market.resolution_time).abs();
        require!(
            publish_time_delta <= PRICE_TIMESTAMP_TOLERANCE_SECONDS,
            MarketError::InvalidPriceTimestamp
        );

        // Scale target_price (whole USD) to match Pyth's fixed-point representation.
        // Pyth prices use a negative exponent, e.g. price=7337436924469 exp=-8 → $73,374.37
        let neg_exp = (-price.exponent) as u32;
        let target_scaled = (market.target_price as i128)
            .checked_mul(
                10i128
                    .checked_pow(neg_exp)
                    .ok_or(MarketError::Overflow)?,
            )
            .ok_or(MarketError::Overflow)?;

        let outcome = (price.price as i128) > target_scaled;

        msg!(
            "Resolve: publish_time={}, price={} * 10^{}, target=${}, outcome={}",
            price.publish_time,
            price.price,
            price.exponent,
            market.target_price,
            if outcome { "YES" } else { "NO" }
        );

        let market = &mut ctx.accounts.market;
        market.resolved = true;
        market.outcome = Some(outcome);

        Ok(())
    }

    pub fn claim_winnings(ctx: Context<ClaimWinnings>) -> Result<()> {
        let market = &ctx.accounts.market;
        let position = &ctx.accounts.user_position;

        require!(market.resolved, MarketError::NotResolved);
        require!(!position.claimed, MarketError::AlreadyClaimed);

        let outcome = market.outcome.unwrap();

        let (user_winning_bet, total_winning_pool, total_losing_pool) = if outcome {
            (position.yes_amount, market.yes_pool, market.no_pool)
        } else {
            (position.no_amount, market.no_pool, market.yes_pool)
        };

        require!(user_winning_bet > 0, MarketError::NoWinnings);

        let winnings = (user_winning_bet as u128)
            .checked_mul(total_losing_pool as u128)
            .ok_or(MarketError::Overflow)?
            .checked_div(total_winning_pool as u128)
            .ok_or(MarketError::Overflow)? as u64;

        let total_payout = user_winning_bet
            .checked_add(winnings)
            .ok_or(MarketError::Overflow)?;

        let market_account_info = ctx.accounts.market.to_account_info();
        let user_account_info = ctx.accounts.user.to_account_info();

        **market_account_info.try_borrow_mut_lamports()? -= total_payout;
        **user_account_info.try_borrow_mut_lamports()? += total_payout;

        let position = &mut ctx.accounts.user_position;
        position.claimed = true;

        Ok(())
    }
}

#[derive(Accounts)]
#[instruction(market_id: u64, question: String)]
pub struct CreateMarket<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(
        init,
        payer = creator,
        space = 8 + Market::INIT_SPACE,
        seeds = [b"market", creator.key().as_ref(), &market_id.to_le_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PlaceBet<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + UserPosition::INIT_SPACE,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub user_position: Account<'info, UserPosition>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ResolveMarket<'info> {
    /// Anyone can resolve a market after the deadline.
    pub resolver: Signer<'info>,

    #[account(mut)]
    pub market: Account<'info, Market>,
    pub price_update: Account<'info, PriceUpdateV2>,
}

#[derive(Accounts)]
pub struct ClaimWinnings<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.creator.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"position", market.key().as_ref(), user.key().as_ref()],
        bump = user_position.bump,
        constraint = user_position.user == user.key(),
    )]
    pub user_position: Account<'info, UserPosition>,
}
