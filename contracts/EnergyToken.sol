// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/**
 * @title EnergyToken
 * @dev Settlement token (e.g., Micro-Rupee / EUR-cent / Energy Stable Credit)
 * used for settling peer-to-peer solar energy trades and grid wheeling fees.
 * Complies with closed-loop utility token standards (avoiding speculative security/crypto classification).
 */
contract EnergyToken is ERC20, ERC20Burnable, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    event FaucetDispensed(address indexed recipient, uint256 amount);

    constructor(
        string memory name,
        string memory symbol,
        address initialAdmin
    ) ERC20(name, symbol) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(MINTER_ROLE, initialAdmin);
        _grantRole(OPERATOR_ROLE, initialAdmin);

        // Pre-mint initial liquidity pool to admin (e.g. 10,000,000 units with 18 decimals)
        _mint(initialAdmin, 10_000_000 * 10 ** decimals());
    }

    /**
     * @notice Mints new tokens for authorized entities (e.g. Fiat on-ramp or Microgrid Escrow)
     * @param to Destination address
     * @param amount Token amount to mint
     */
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /**
     * @notice Utility faucet for local sandbox testing & onboarding prosumers
     * @param recipient Target prosumer/consumer address
     * @param amount Amount of demo tokens to dispense
     */
    function requestSandboxTokens(address recipient, uint256 amount) external {
        require(amount <= 10_000 * 10 ** decimals(), "Exceeds faucet single-call quota");
        _mint(recipient, amount);
        emit FaucetDispensed(recipient, amount);
    }
}
