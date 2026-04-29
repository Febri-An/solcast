use anchor_lang::prelude::*;

pub const MAX_QUESTION_LEN: usize = 200;

/// Maximum fee in basis points (10%). Anything above is rejected as a mistake.
pub const MAX_FEE_BPS: u16 = 1_000;

/// Minimum seed liquidity required from the admin at market creation (0.1 SOL).
pub const MIN_INITIAL_LIQUIDITY_LAMPORTS: u64 = 100_000_000;

/// AMM-based prediction market.
///
/// The market is a Polymarket-style conditional-token CFMM:
/// - `initial_liquidity` lamports are seeded by the admin at creation.
/// - `yes_shares` and `no_shares` start equal to `initial_liquidity` and
///   evolve via CPMM swaps (`k = yes_shares * no_shares`).
/// - Every buy mints `D_net` YES + `D_net` NO from user lamports
///   (after fee), swaps one side in the pool, and returns the net to
///   the user.
/// - Every sell is the reverse: user returns shares to the pool, a
///   matching pair is burned, and lamports are paid out.
/// - At resolve, each winning share redeems for 1 lamport from the
///   treasury (the market PDA itself).
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
    /// Strike in USD: either whole dollars (`target_price_encoding == 0`, e.g. 79000 = $79,000)
    /// or nanodollars (`target_price_encoding == 1`, e.g. 79_000_000_000_000 = $79,000.000).
    pub target_price: i64,

    /// YES shares currently held by the AMM pool.
    pub yes_shares: u64,
    /// NO shares currently held by the AMM pool.
    pub no_shares: u64,
    /// Sum of `yes_shares` across all `UserPosition`s. Used for solvency checks.
    pub yes_supply_user: u64,
    /// Sum of `no_shares` across all `UserPosition`s.
    pub no_supply_user: u64,

    /// Swap fee in basis points (1 bp = 0.01%). `200` = 2%.
    pub fee_bps: u16,
    /// Admin's initial SOL deposit (== starting `yes_shares` == starting `no_shares`).
    pub initial_liquidity: u64,
    /// Set once the admin has claimed the LP side of the pool after resolve.
    pub liquidity_withdrawn: bool,

    pub resolved: bool,
    /// `Some(true)` = YES won, `Some(false)` = NO won.
    pub outcome: Option<bool>,
    /// `0` = `target_price` is whole USD. `1` = `target_price` is USD × 1e9 (9 decimal places).
    pub target_price_encoding: u8,
    pub bump: u8,
}

/// Per-user, per-market share balances. Claim is implicit: once the
/// winning shares are redeemed, the balance drops to zero.
#[account]
#[derive(InitSpace)]
pub struct UserPosition {
    pub market: Pubkey,
    pub user: Pubkey,
    pub yes_shares: u64,
    pub no_shares: u64,
    pub bump: u8,
}
