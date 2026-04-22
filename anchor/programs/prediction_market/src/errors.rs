use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Resolution time must be in the future")]
    ResolutionTimeInPast,
    #[msg("Trading is closed for this market")]
    BettingClosed,
    #[msg("Amount must be greater than zero")]
    InvalidBetAmount,
    #[msg("Market cannot be resolved yet")]
    ResolutionTooEarly,
    #[msg("Market has already been resolved")]
    AlreadyResolved,
    #[msg("Market has not been resolved yet")]
    NotResolved,
    #[msg("No winnings to claim")]
    NoWinnings,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Target price must be greater than zero")]
    InvalidTargetPrice,
    #[msg("Resolve window has closed")]
    ResolveWindowClosed,
    #[msg("Price update timestamp is outside the allowed resolution window")]
    InvalidPriceTimestamp,
    #[msg("Only the admin can perform this action")]
    Unauthorized,

    // --- AMM-specific ---
    #[msg("Swap fee in basis points is above the allowed maximum")]
    InvalidFee,
    #[msg("Initial liquidity is below the required minimum")]
    InitialLiquidityTooLow,
    #[msg("Computed output is below the requested minimum (slippage too high)")]
    SlippageExceeded,
    #[msg("Pool has insufficient shares to fulfil the swap")]
    PoolDepleted,
    #[msg("User does not hold enough shares for this operation")]
    InsufficientShares,
    #[msg("Liquidity has already been withdrawn")]
    LiquidityAlreadyWithdrawn,
    #[msg("Trading is not allowed after market resolve")]
    TradingAfterResolve,
}
