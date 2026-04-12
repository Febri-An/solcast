use anchor_lang::prelude::*;

/// Maximum length of a market question
pub const MAX_QUESTION_LEN: usize = 200;

/// Market account storing prediction market state
#[account]
#[derive(InitSpace)]
pub struct Market {
    pub creator: Pubkey,
    pub market_id: u64,
    #[max_len(MAX_QUESTION_LEN)]
    pub question: String,
    pub resolution_time: i64,
    /// Pyth price feed identifier (e.g. BTC/USD, SOL/USD)
    pub feed_id: [u8; 32],
    /// Target price in whole USD (e.g. 79000 = $79,000). YES = price above target.
    pub target_price: i64,
    pub yes_pool: u64,
    pub no_pool: u64,
    /// Whether the market has been resolved
    pub resolved: bool,
    /// Some(true) = price was above target (YES won)
    pub outcome: Option<bool>,
    pub bump: u8,
}

/// User position in a specific market
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    /// The market this position is for
    pub market: Pubkey,
    /// The user who owns this position
    pub user: Pubkey,
    /// Lamports bet on YES
    pub yes_amount: u64,
    /// Lamports bet on NO
    pub no_amount: u64,
    /// Whether winnings have been claimed
    pub claimed: bool,
    /// PDA bump seed
    pub bump: u8,
}
