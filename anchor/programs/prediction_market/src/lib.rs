use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

mod errors;
mod math;
mod state;

use errors::MarketError;
use math::{apply_fee, buy_shares_out, sell_sol_out};
use state::{
    Market, UserPosition, MAX_FEE_BPS, MAX_QUESTION_LEN, MIN_INITIAL_LIQUIDITY_LAMPORTS,
};

const PRICE_TIMESTAMP_TOLERANCE_SECONDS: i64 = 30;
const RESOLVE_GRACE_PERIOD_SECONDS: i64 = 30 * 60;

/// Only this wallet may create markets or withdraw LP. Rotating the admin
/// requires redeploying the program (upgrade to a Config PDA if that becomes
/// a pain). Base58: `B3WBoPbb2a98NrqRXBEe4P49irNCH8PEA4xzKzaYhXXr`.
pub const ADMIN: Pubkey = Pubkey::new_from_array([
    149, 57, 8, 37, 217, 54, 152, 179, 44, 242, 47, 141, 161, 3, 240, 203, 134, 245, 19, 209, 131,
    219, 239, 89, 154, 143, 19, 236, 94, 165, 186, 69,
]);

declare_id!("DYy72hMhhyHvbPjy71pp4137U4FumNuzM6i3mLVU2MWk");

#[program]
pub mod prediction_market {
    use super::*;

    /// Admin creates a market AND seeds the initial AMM liquidity in the
    /// same transaction. Pool starts at `(initial_liquidity, initial_liquidity)`
    /// which implies a 50/50 starting price for YES/NO.
    pub fn create_market(
        ctx: Context<CreateMarket>,
        market_id: u64,
        question: String,
        resolution_time: i64,
        feed_id: [u8; 32],
        target_price: i64,
        initial_liquidity: u64,
        fee_bps: u16,
    ) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.creator.key(),
            ADMIN,
            MarketError::Unauthorized
        );
        require!(question.len() <= MAX_QUESTION_LEN, MarketError::Overflow);
        require!(target_price > 0, MarketError::InvalidTargetPrice);
        require!(fee_bps <= MAX_FEE_BPS, MarketError::InvalidFee);
        require!(
            initial_liquidity >= MIN_INITIAL_LIQUIDITY_LAMPORTS,
            MarketError::InitialLiquidityTooLow
        );

        let clock = Clock::get()?;
        require!(
            resolution_time > clock.unix_timestamp,
            MarketError::ResolutionTimeInPast
        );

        // Transfer the seed SOL from the admin into the market PDA treasury.
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            initial_liquidity,
        )?;

        let market = &mut ctx.accounts.market;
        market.creator = ctx.accounts.creator.key();
        market.market_id = market_id;
        market.question = question;
        market.resolution_time = resolution_time;
        market.feed_id = feed_id;
        market.target_price = target_price;
        market.yes_shares = initial_liquidity;
        market.no_shares = initial_liquidity;
        market.yes_supply_user = 0;
        market.no_supply_user = 0;
        market.fee_bps = fee_bps;
        market.initial_liquidity = initial_liquidity;
        market.liquidity_withdrawn = false;
        market.resolved = false;
        market.outcome = None;
        market.bump = ctx.bumps.market;

        Ok(())
    }

    /// Buy `amount_in` lamports worth of YES or NO shares via the AMM.
    /// Fails if actual output is below `min_shares_out` (slippage guard).
    pub fn buy(
        ctx: Context<Trade>,
        amount_in: u64,
        buy_yes: bool,
        min_shares_out: u64,
    ) -> Result<()> {
        require!(amount_in > 0, MarketError::InvalidBetAmount);

        let clock = Clock::get()?;
        {
            let market = &ctx.accounts.market;
            require!(!market.resolved, MarketError::TradingAfterResolve);
            require!(
                clock.unix_timestamp < market.resolution_time,
                MarketError::BettingClosed
            );
        }

        // Pay in first (system_program CPI), then mutate state.
        transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.market.to_account_info(),
                },
            ),
            amount_in,
        )?;

        let market = &mut ctx.accounts.market;
        let (_fee, d_net) = apply_fee(amount_in, market.fee_bps)?;
        require!(d_net > 0, MarketError::InvalidBetAmount);

        let (shares_out, new_same, new_other) = if buy_yes {
            // same-side = YES (wants more YES), other = NO
            buy_shares_out(market.yes_shares, market.no_shares, d_net)?
        } else {
            buy_shares_out(market.no_shares, market.yes_shares, d_net)?
        };

        require!(shares_out >= min_shares_out, MarketError::SlippageExceeded);

        if buy_yes {
            market.yes_shares = new_same;
            market.no_shares = new_other;
            market.yes_supply_user = market
                .yes_supply_user
                .checked_add(shares_out)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.no_shares = new_same;
            market.yes_shares = new_other;
            market.no_supply_user = market
                .no_supply_user
                .checked_add(shares_out)
                .ok_or(MarketError::Overflow)?;
        }

        let position = &mut ctx.accounts.user_position;
        init_position_if_needed(position, market.key(), ctx.accounts.user.key(), ctx.bumps.user_position);
        if buy_yes {
            position.yes_shares = position
                .yes_shares
                .checked_add(shares_out)
                .ok_or(MarketError::Overflow)?;
        } else {
            position.no_shares = position
                .no_shares
                .checked_add(shares_out)
                .ok_or(MarketError::Overflow)?;
        }

        msg!(
            "buy {} shares={} fee={} pool=({}, {})",
            if buy_yes { "YES" } else { "NO" },
            shares_out,
            _fee,
            market.yes_shares,
            market.no_shares
        );

        Ok(())
    }

    /// Sell `shares_in` YES (or NO) shares back into the AMM for SOL.
    /// Fails if SOL returned is below `min_sol_out` (slippage guard).
    pub fn sell(
        ctx: Context<Trade>,
        shares_in: u64,
        sell_yes: bool,
        min_sol_out: u64,
    ) -> Result<()> {
        require!(shares_in > 0, MarketError::InvalidBetAmount);

        let clock = Clock::get()?;
        {
            let market = &ctx.accounts.market;
            require!(!market.resolved, MarketError::TradingAfterResolve);
            require!(
                clock.unix_timestamp < market.resolution_time,
                MarketError::BettingClosed
            );
        }

        // Make sure the user actually owns enough shares to burn.
        {
            let position = &ctx.accounts.user_position;
            let owned = if sell_yes { position.yes_shares } else { position.no_shares };
            require!(owned >= shares_in, MarketError::InsufficientShares);
        }

        let market = &mut ctx.accounts.market;

        let (sol_out, new_same, new_other) = if sell_yes {
            sell_sol_out(market.yes_shares, market.no_shares, shares_in)?
        } else {
            sell_sol_out(market.no_shares, market.yes_shares, shares_in)?
        };
        require!(sol_out >= min_sol_out, MarketError::SlippageExceeded);

        if sell_yes {
            market.yes_shares = new_same;
            market.no_shares = new_other;
            market.yes_supply_user = market
                .yes_supply_user
                .checked_sub(shares_in)
                .ok_or(MarketError::Overflow)?;
        } else {
            market.no_shares = new_same;
            market.yes_shares = new_other;
            market.no_supply_user = market
                .no_supply_user
                .checked_sub(shares_in)
                .ok_or(MarketError::Overflow)?;
        }

        let position = &mut ctx.accounts.user_position;
        if sell_yes {
            position.yes_shares = position
                .yes_shares
                .checked_sub(shares_in)
                .ok_or(MarketError::Overflow)?;
        } else {
            position.no_shares = position
                .no_shares
                .checked_sub(shares_in)
                .ok_or(MarketError::Overflow)?;
        }

        // Pay lamports out of the market PDA.
        pay_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            sol_out,
        )?;

        msg!(
            "sell {} shares_in={} sol_out={} pool=({}, {})",
            if sell_yes { "YES" } else { "NO" },
            shares_in,
            sol_out,
            ctx.accounts.market.yes_shares,
            ctx.accounts.market.no_shares
        );

        Ok(())
    }

    /// Permissionless resolve: anyone can trigger after deadline.
    /// Outcome is determined by comparing the Pyth price against
    /// the market's `target_price`.
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
            "resolve publish={} price={}*10^{} target=${} outcome={}",
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

    /// Redeem all winning shares held by the user at 1 lamport each.
    /// Losing-side shares are simply zeroed (they are worthless).
    pub fn redeem(ctx: Context<Redeem>) -> Result<()> {
        let (outcome, _) = {
            let market = &ctx.accounts.market;
            require!(market.resolved, MarketError::NotResolved);
            (
                market.outcome.ok_or(MarketError::NotResolved)?,
                market.bump,
            )
        };

        let position = &mut ctx.accounts.user_position;
        let (winning_shares, losing_shares) = if outcome {
            (position.yes_shares, position.no_shares)
        } else {
            (position.no_shares, position.yes_shares)
        };
        require!(winning_shares > 0, MarketError::NoWinnings);

        position.yes_shares = 0;
        position.no_shares = 0;
        let _ = losing_shares; // make the symmetry explicit to the reader

        // Decrement market-level user supply accounting so solvency invariants stay true.
        {
            let market = &mut ctx.accounts.market;
            if outcome {
                market.yes_supply_user = market
                    .yes_supply_user
                    .checked_sub(winning_shares)
                    .ok_or(MarketError::Overflow)?;
                market.no_supply_user = market
                    .no_supply_user
                    .checked_sub(losing_shares)
                    .ok_or(MarketError::Overflow)?;
            } else {
                market.no_supply_user = market
                    .no_supply_user
                    .checked_sub(winning_shares)
                    .ok_or(MarketError::Overflow)?;
                market.yes_supply_user = market
                    .yes_supply_user
                    .checked_sub(losing_shares)
                    .ok_or(MarketError::Overflow)?;
            }
        }

        pay_from_market(
            &ctx.accounts.market.to_account_info(),
            &ctx.accounts.user.to_account_info(),
            winning_shares,
        )?;

        msg!("redeem winning={}", winning_shares);
        Ok(())
    }

    /// Admin claims the pool's LP position after resolve — pays out
    /// `pool_winning_shares` lamports (the pool's remaining share of the
    /// winning token) plus any residual treasury beyond user obligations.
    pub fn withdraw_liquidity(ctx: Context<WithdrawLiquidity>) -> Result<()> {
        require_keys_eq!(
            ctx.accounts.admin.key(),
            ADMIN,
            MarketError::Unauthorized
        );

        let (outcome, pool_winning, user_outstanding, already) = {
            let market = &ctx.accounts.market;
            require!(market.resolved, MarketError::NotResolved);
            require!(
                !market.liquidity_withdrawn,
                MarketError::LiquidityAlreadyWithdrawn
            );
            let outcome = market.outcome.ok_or(MarketError::NotResolved)?;
            let pool_winning = if outcome { market.yes_shares } else { market.no_shares };
            let user_outstanding = if outcome {
                market.yes_supply_user
            } else {
                market.no_supply_user
            };
            (outcome, pool_winning, user_outstanding, market.liquidity_withdrawn)
        };
        let _ = already;

        // Compute withdrawable = treasury balance - rent-exempt minimum - user_outstanding.
        // The remaining `user_outstanding` must stay locked for redemptions.
        let market_ai = ctx.accounts.market.to_account_info();
        let rent = Rent::get()?;
        let min_rent = rent.minimum_balance(market_ai.data_len());
        let balance = market_ai.lamports();
        let reserved = min_rent
            .checked_add(user_outstanding)
            .ok_or(MarketError::Overflow)?;
        let withdrawable = balance.saturating_sub(reserved);
        require!(withdrawable > 0, MarketError::NoWinnings);

        // Pool's winning share claim is always <= withdrawable by construction
        // (treasury always covers user_outstanding + pool_winning + fees). We
        // send `withdrawable` which equals pool_winning + accumulated_fees.
        let _ = (pool_winning, outcome); // kept for log clarity below

        pay_from_market(&market_ai, &ctx.accounts.admin.to_account_info(), withdrawable)?;

        let market = &mut ctx.accounts.market;
        market.liquidity_withdrawn = true;
        msg!(
            "withdraw_liquidity outcome={} pool_winning={} withdrawable={} user_outstanding={}",
            if outcome { "YES" } else { "NO" },
            pool_winning,
            withdrawable,
            user_outstanding
        );
        Ok(())
    }
}

/// Initialise a fresh `UserPosition` in place the first time a user trades.
fn init_position_if_needed(
    position: &mut Account<UserPosition>,
    market: Pubkey,
    user: Pubkey,
    bump: u8,
) {
    if position.market == Pubkey::default() {
        position.market = market;
        position.user = user;
        position.yes_shares = 0;
        position.no_shares = 0;
        position.bump = bump;
    }
}

/// Transfer lamports out of the market PDA (it's a system-owned Account owned
/// by the program, so we can just mutate lamports directly).
fn pay_from_market(
    market: &AccountInfo,
    recipient: &AccountInfo,
    amount: u64,
) -> Result<()> {
    **market.try_borrow_mut_lamports()? = market
        .lamports()
        .checked_sub(amount)
        .ok_or(MarketError::Overflow)?;
    **recipient.try_borrow_mut_lamports()? = recipient
        .lamports()
        .checked_add(amount)
        .ok_or(MarketError::Overflow)?;
    Ok(())
}

// =============================================================================
// Account contexts
// =============================================================================

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

/// Shared context for buy and sell — both need the market PDA plus the
/// user's (init_if_needed) position account.
#[derive(Accounts)]
pub struct Trade<'info> {
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
pub struct Redeem<'info> {
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

#[derive(Accounts)]
pub struct WithdrawLiquidity<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.creator.as_ref(), &market.market_id.to_le_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}
