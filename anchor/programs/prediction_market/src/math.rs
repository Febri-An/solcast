//! CPMM math for the prediction-market AMM.
//!
//! All computations are done in `u128` to keep intermediates well within
//! u64 bounds even for pool sizes up to ~10^15 lamports.
//!
//! Formulas (Gnosis-FPMM-style conditional-token CFMM):
//!
//! * Buy YES for `d_net` collateral (fee already removed):
//!   - Mint `d_net` YES + `d_net` NO.
//!   - Deposit `d_net` NO into pool; withdraw YES to restore `k`.
//!   - `shares_out = d_net * (yes_pool + no_pool + d_net) / (no_pool + d_net)`
//!   - Pool after: `(yes_pool * no_pool / (no_pool + d_net), no_pool + d_net)`.
//!
//! * Sell `delta` YES shares for SOL:
//!   - Return `delta` YES to pool (intermediate `(yes + delta, no)`).
//!   - Burn `X` YES + `X` NO from pool and return `X` SOL.
//!   - `X² − X·(yes_pool + no_pool + delta) + delta·no_pool = 0`
//!   - Pool after: `(yes + delta − X, no − X)`.
//!
//! The NO side is symmetric.

use crate::errors::MarketError;
use anchor_lang::prelude::*;

/// Babylonian integer square root for `u128`.
pub fn sqrt_u128(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// Fee split. Returns `(fee, d_net)` where `fee + d_net == amount`.
pub fn apply_fee(amount: u64, fee_bps: u16) -> Result<(u64, u64)> {
    let fee = (amount as u128)
        .checked_mul(fee_bps as u128)
        .ok_or(MarketError::Overflow)?
        .checked_div(10_000)
        .ok_or(MarketError::Overflow)? as u64;
    let d_net = amount.checked_sub(fee).ok_or(MarketError::Overflow)?;
    Ok((fee, d_net))
}

/// How many winning-side shares the user receives for `d_net` collateral.
///
/// `in_pool_same_side`: current pool balance of the side the user is buying
/// `in_pool_other_side`: pool balance of the opposite side
///
/// Returns `(shares_out, new_same_side, new_other_side)`.
pub fn buy_shares_out(
    in_pool_same_side: u64,
    in_pool_other_side: u64,
    d_net: u64,
) -> Result<(u64, u64, u64)> {
    require!(d_net > 0, MarketError::InvalidBetAmount);
    require!(
        in_pool_same_side > 0 && in_pool_other_side > 0,
        MarketError::PoolDepleted
    );

    let y = in_pool_same_side as u128; // same side the buyer wants
    let n = in_pool_other_side as u128; // opposite side (goes deeper into pool)
    let d = d_net as u128;

    // shares_out = d * (y + n + d) / (n + d)
    let denom = n.checked_add(d).ok_or(MarketError::Overflow)?;
    let numer = d
        .checked_mul(
            y.checked_add(n)
                .ok_or(MarketError::Overflow)?
                .checked_add(d)
                .ok_or(MarketError::Overflow)?,
        )
        .ok_or(MarketError::Overflow)?;
    let shares_out = numer.checked_div(denom).ok_or(MarketError::Overflow)?;
    require!(shares_out <= u64::MAX as u128, MarketError::Overflow);

    // New pool same-side = y * n / (n + d)
    let new_same = y
        .checked_mul(n)
        .ok_or(MarketError::Overflow)?
        .checked_div(denom)
        .ok_or(MarketError::Overflow)?;
    let new_other = denom; // n + d

    require!(new_same > 0, MarketError::PoolDepleted);
    require!(new_same <= u64::MAX as u128, MarketError::Overflow);

    Ok((shares_out as u64, new_same as u64, new_other as u64))
}

/// How much SOL the user receives when selling `delta` shares of one side.
///
/// `in_pool_same_side`: pool balance of the side being sold (grows by `delta`)
/// `in_pool_other_side`: pool balance of the opposite side (shrinks by X)
///
/// Returns `(sol_out, new_same_side, new_other_side)` where
/// `new_same = same + delta - X` and `new_other = other - X`.
pub fn sell_sol_out(
    in_pool_same_side: u64,
    in_pool_other_side: u64,
    delta: u64,
) -> Result<(u64, u64, u64)> {
    require!(delta > 0, MarketError::InvalidBetAmount);
    require!(
        in_pool_same_side > 0 && in_pool_other_side > 0,
        MarketError::PoolDepleted
    );

    let y = in_pool_same_side as u128;
    let n = in_pool_other_side as u128;
    let d = delta as u128;

    // Solve X^2 - B*X + d*n = 0  where  B = y + n + d
    let b = y
        .checked_add(n)
        .ok_or(MarketError::Overflow)?
        .checked_add(d)
        .ok_or(MarketError::Overflow)?;
    let b_sq = b.checked_mul(b).ok_or(MarketError::Overflow)?;
    let four_dn = d
        .checked_mul(n)
        .ok_or(MarketError::Overflow)?
        .checked_mul(4)
        .ok_or(MarketError::Overflow)?;
    let disc = b_sq.checked_sub(four_dn).ok_or(MarketError::Overflow)?;
    let sqrt_disc = sqrt_u128(disc);
    // X = (B - sqrt(B^2 - 4dn)) / 2 — pick the smaller root
    let x = b.checked_sub(sqrt_disc).ok_or(MarketError::Overflow)? / 2;

    // Pool updates
    let new_same = y
        .checked_add(d)
        .ok_or(MarketError::Overflow)?
        .checked_sub(x)
        .ok_or(MarketError::Overflow)?;
    let new_other = n.checked_sub(x).ok_or(MarketError::Overflow)?;

    require!(new_same > 0 && new_other > 0, MarketError::PoolDepleted);
    require!(
        new_same <= u64::MAX as u128 && new_other <= u64::MAX as u128 && x <= u64::MAX as u128,
        MarketError::Overflow
    );

    Ok((x as u64, new_same as u64, new_other as u64))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buy_preserves_k_approximately() {
        let (out, new_y, new_n) = buy_shares_out(10_000_000_000, 10_000_000_000, 1_000_000_000).unwrap();
        // User ends with d_net + (yP - new_y) = 1e9 + (1e10 - new_y)
        // Pool k should be preserved: new_y * new_n ≈ 1e10 * 1e10 = 1e20
        let k_new = (new_y as u128) * (new_n as u128);
        let k_old: u128 = 10_000_000_000u128 * 10_000_000_000u128;
        // Integer truncation may lose up to ~new_n in k; check within 0.01%.
        assert!(
            k_new >= k_old.saturating_sub(k_old / 10_000)
                && k_new <= k_old.saturating_add(k_old / 10_000),
            "k drift too large: {k_old} → {k_new}"
        );
        assert!(out > 1_000_000_000);
    }

    #[test]
    fn sell_preserves_k_approximately() {
        // Start from a pool that's been bought into: simulate buy then sell.
        let (shares_bought, y_after_buy, n_after_buy) =
            buy_shares_out(10_000_000_000, 10_000_000_000, 1_000_000_000).unwrap();

        let (sol_out, y_after_sell, n_after_sell) =
            sell_sol_out(y_after_buy, n_after_buy, shares_bought).unwrap();

        // Selling everything should return close to (but <= 1 SOL) after fee-free roundtrip.
        // Actually >1 is possible because buyer moved price; here we just check consistency.
        let k_after = (y_after_sell as u128) * (n_after_sell as u128);
        let k_start: u128 = 10_000_000_000u128 * 10_000_000_000u128;
        assert!(
            k_after >= k_start.saturating_sub(k_start / 10_000),
            "k after sell drifted too far"
        );
        assert!(sol_out > 0);
    }

    #[test]
    fn sqrt_basic() {
        assert_eq!(sqrt_u128(0), 0);
        assert_eq!(sqrt_u128(1), 1);
        assert_eq!(sqrt_u128(100), 10);
        // floor(sqrt(10^25)) = floor(10^12.5) = 3_162_277_660_168
        assert_eq!(sqrt_u128(10u128.pow(25)), 3_162_277_660_168);
        // exact: floor(sqrt((2^63)^2)) == 2^63
        assert_eq!(sqrt_u128(1u128 << 126), 1u128 << 63);
    }
}
