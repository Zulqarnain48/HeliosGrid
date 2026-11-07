# HeliosGrid: Peer-to-Peer Solar Energy Trading Platform

**A Blockchain-Based Solution for Decentralized Solar Energy Trading, Dynamic Pricing, and National Grid Settlement**

**Project Scenario:** Scenario D – Decentralized Rooftop Solar Trading with Dynamic Pricing and National Grid Interconnection

**Developed By:** Consulting Engineering Group

**Technology Stack:** Solidity 0.8.24 | Hardhat | OpenZeppelin Contracts v5 | JavaScript | Python

---

## 1. Project Overview

HeliosGrid is a blockchain-based peer-to-peer (P2P) energy trading platform designed to support decentralized electricity trading within residential communities.

In traditional electricity systems, households with rooftop solar panels may generate more electricity than they consume. This excess energy is often supplied to the national grid, while nearby households continue purchasing electricity from the grid.

HeliosGrid introduces a decentralized marketplace where households can trade surplus solar energy directly with neighbouring consumers through blockchain-based smart contracts.

The platform provides a transparent way to manage energy trading, dynamic pricing, smart meter registration, transaction settlements, and community battery operations.

By using blockchain technology, the system aims to improve transaction transparency, reduce dependence on centralized trading processes, and provide a reliable record of energy transactions.

## 2. Problem Statement

Traditional electricity distribution systems face several challenges when managing decentralized solar energy production.

The major challenges include:

- **Limited Peer-to-Peer Trading:** Solar energy producers have limited opportunities to trade surplus electricity directly with nearby consumers.
- **Pricing Transparency:** Consumers and producers may not have access to a transparent mechanism for determining electricity trading prices.
- **Transaction Management:** Centralized systems can make energy trading, payment tracking, and settlement processes more complicated.
- **Data Security:** Smart meter readings and household energy consumption information require appropriate protection.
- **Grid Integration:** Energy trading platforms must account for grid-related charges, applicable taxes, and distribution requirements.

HeliosGrid addresses these challenges through a smart contract-based energy trading framework.

## 3. Project Objectives

The primary objectives of HeliosGrid are:

1. Develop a decentralized marketplace for peer-to-peer solar energy trading.
2. Implement smart contracts to manage energy transactions and automated settlements.
3. Introduce dynamic pricing through a double-auction trading mechanism.
4. Register and manage smart meter identities and authenticated energy readings.
5. Incorporate national grid charges and applicable settlement deductions.
6. Support community battery registration and energy accounting.
7. Improve transaction transparency, security, and accountability through blockchain technology.

## 4. Key Features

### 4.1 Peer-to-Peer Energy Trading

The platform enables solar energy producers (prosumers) to offer their surplus electricity to nearby consumers.

Consumers can submit purchase orders, while producers can create selling orders. The smart contract matches compatible orders according to the defined trading rules.

### 4.2 Dynamic Energy Pricing

HeliosGrid uses a double-auction mechanism to determine trading prices.

Buyers submit their maximum purchase prices, while sellers specify their minimum selling prices.

When a buyer's bid meets or exceeds a seller's asking price, the system calculates a clearing price using the midpoint of both prices.

### 4.3 Blockchain-Based Settlement

Smart contracts manage transaction execution and settlement.

The system calculates the transaction amount, applicable deductions, and the final payment to the energy producer.

This creates a transparent and traceable record of financial transactions.

### 4.4 Smart Meter Registration

The Smart Meter Registry manages smart meter identities and energy reading verification.

It includes device registration, digital signature verification, and Merkle-based data integrity mechanisms.

The system also applies generation limits to identify potentially abnormal solar energy readings.

### 4.5 National Grid Settlement

The platform incorporates configurable grid wheeling charges and tax deductions into its settlement calculations.

This allows energy transactions to account for the financial requirements associated with national grid interconnection.

### 4.6 Community Battery Management

The Community Battery Manager supports battery registration and charge/discharge accounting.

It provides a framework for managing shared energy storage within a residential community.

## 5. System Architecture

HeliosGrid follows a modular architecture in which individual smart contracts handle different responsibilities.

The main components include:

**1. Energy Token Layer**

Manages the utility token used for energy trading and settlement within the platform.

**2. Smart Meter Registry Layer**

Handles device registration, digital signatures, reading validation, and data integrity.

**3. Grid Tariff Management Layer**

Manages configurable grid charges, settlement deductions, and curtailment-related rules.

**4. Energy Trading Layer**

Handles buying and selling orders, order matching, escrow management, and transaction settlements.

**5. Community Battery Layer**

Manages community battery registration and energy accounting.

These components work together to provide a structured environment for decentralized energy trading.

## 6. Smart Contract Modules

The project contains five main Solidity smart contracts.

| Smart Contract | Main Responsibility |
|---|---|
| EnergyToken.sol | Manages utility tokens used for energy settlement. |
| SmartMeterRegistry.sol | Registers smart meters and validates energy readings. |
| GridTariffManager.sol | Handles configurable grid charges and settlement deductions. |
| EnergyTradingPlatform.sol | Manages trading orders, matching, escrow, and settlements. |
| CommunityBatteryManager.sol | Manages community battery registration and accounting. |

The contracts are developed using Solidity 0.8.24 and OpenZeppelin Contracts v5.

## 7. Technology Stack

| Technology | Purpose |
|---|---|
| Solidity 0.8.24 | Smart contract development |
| Hardhat | Smart contract compilation, testing, and deployment |
| OpenZeppelin v5 | Reusable and secure smart contract components |
| JavaScript | Deployment and simulation scripts |
| Python | Static analysis and security checks |
| Ethereum Virtual Machine | Local blockchain execution environment |
| MetaMask | Wallet connection and transaction interaction |

## 8. Project Directory Structure

```text
HeliosGrid/
│
├── contracts/
│   ├── EnergyToken.sol
│   ├── SmartMeterRegistry.sol
│   ├── GridTariffManager.sol
│   ├── EnergyTradingPlatform.sol
│   └── CommunityBatteryManager.sol
│
├── scripts/
│   ├── deploy_and_simulate.js
│   ├── generate_benchmarks.js
│   └── static_analyzer.py
│
├── test/
│   └── EnergyTrading.test.js
│
├── docs/
│   ├── CONSULTING_ENGINEERING_REPORT.md
│   ├── SECURITY_AUDIT_REPORT.md
│   └── STATIC_ANALYSIS_REPORT.json
│
├── hardhat.config.js
├── package.json
└── README.md
```

## 9. Mathematical Model

### 9.1 Dynamic Pricing Mechanism

The platform calculates the clearing price when a buyer's bid is equal to or greater than a seller's asking price.

The midpoint pricing formula is:

P_cleared = (P_bid + P_ask) / 2

Where:

- P_cleared represents the final trading price.
- P_bid represents the buyer's maximum offered price.
- P_ask represents the seller's minimum asking price.

The buyer receives a refund for the unused portion of the initially reserved amount.

### 9.2 Grid Charges and Tax Calculation

The gross transaction value is calculated as:

G = Q × P_cleared

Where Q represents the quantity of electricity traded.

The settlement mechanism calculates:

- Grid Wheeling Fee: W = G × μ_wheeling × κ_peak
- Tax Deduction: T = G × μ_tax
- Producer Payment: R = G − W − T

The current project scenario uses configurable assumptions of 3% for the wheeling fee and 1% for tax. These are simulation parameters, not a claim that these rates represent current official regulatory tariffs.

### 9.3 Energy Reading Validation

To identify potentially abnormal solar generation readings, the Smart Meter Registry applies a physical generation limit.

ΔGen ≤ P_inverter × Δt × 1.05

Where:

- ΔGen represents the reported energy generated.
- P_inverter represents the inverter's rated power.
- Δt represents the measurement interval.
- 1.05 represents the configured tolerance factor.

Readings exceeding the calculated limit can be flagged for further investigation.

## 10. Installation and Setup

### Prerequisites

Before running the project, install:

- Node.js (v20 or later)
- npm
- Python (v3.10 or later)
- MetaMask (optional, for dashboard wallet interactions)

### Step 1: Clone the Repository

```bash
git clone https://github.com/Zulqarnain48/HeliosGrid.git
cd HeliosGrid
```

### Step 2: Install Dependencies

```bash
npm install
```

### Step 3: Start the Local Blockchain

Open a terminal and execute:

```bash
npm run node:local
```

Keep this terminal running.

### Step 4: Deploy Smart Contracts

Open another terminal and execute:

```bash
npm run deploy:local
```

This deploys the smart contracts to the local Hardhat blockchain.

### Step 5: Start the Dashboard

```bash
npm start
```

Open the following address in your browser:

```text
http://localhost:3000
```

If port 3000 is already occupied, use PowerShell:

```powershell
$env:PORT=3001; npm start
```

Then open:

```text
http://localhost:3001
```

### Step 6: Connect MetaMask

For local wallet interaction, configure MetaMask with:

- Network Name: Local Hardhat
- RPC URL: http://127.0.0.1:8545
- Chain ID: 31337
- Currency Symbol: ETH

Connect a seeded Hardhat test account to interact with the local deployment.

**Important:** Hardhat accounts and their funds are intended only for local testing. Never use their private keys on public networks.

## 11. Testing and Evaluation

HeliosGrid includes automated tests, deployment simulations, benchmarking scripts, and a Python-based static analyzer.

### 11.1 Smart Contract Testing

Run:

```bash
npx hardhat test
```

The test suite covers key operations, including:

- Smart meter registration.
- Digital signature verification.
- Energy reading anomaly detection.
- Trading price validation.
- Buy and sell order matching.
- Partial order execution.
- Order cancellation.

### 11.2 End-to-End Simulation

Run:

```bash
npx hardhat run scripts/deploy_and_simulate.js --network hardhat
```

The simulation demonstrates a residential microgrid scenario involving multiple energy producers and consumers.

It covers energy trading, order matching, settlement calculations, and smart meter data processing.

### 11.3 Gas Consumption Benchmarking

Run:

```bash
npx hardhat run scripts/generate_benchmarks.js --network hardhat
```

This script evaluates smart contract gas consumption and provides estimated cost comparisons under different blockchain transaction-cost assumptions.

### 11.4 Static Security Analysis

Run:

```bash
python scripts/static_analyzer.py
```

The Python analyzer checks selected smart contract patterns, including:

- Reentrancy-related risks.
- Signature replay protection.
- Access control.
- Zero-address validation.

The analyzer provides automated checks and should be treated as an initial security assessment rather than an independent security audit.

## 12. Security and Privacy Considerations

Security and privacy are important aspects of decentralized energy management.

HeliosGrid incorporates several mechanisms to address potential risks:

- **Access Control:** Restricts sensitive contract operations to authorized accounts.
- **Digital Signatures:** Supports verification of smart meter data submissions.
- **Data Integrity:** Uses Merkle-based mechanisms to support verification of submitted data.
- **Anomaly Detection:** Applies physical generation limits to identify suspicious energy readings.
- **Transaction Transparency:** Maintains blockchain records of trading and settlement activities.
- **Privacy Considerations:** Recognizes that detailed household energy consumption data should not be unnecessarily exposed.

The project also includes a STRIDE-based threat analysis and security documentation.

## 13. Project Deliverables

The project is organized around six major engineering deliverables.

**Task 1 – Problem Analysis and Blockchain Justification**

Analysis of the energy trading problem, blockchain suitability, centralized alternatives, and the division between on-chain and off-chain data.

**Task 2 – System Architecture and Platform Selection**

Evaluation of blockchain platforms and development of the proposed decentralized energy trading architecture.

**Task 3 – Smart Contract Design and Implementation**

Development of five Solidity smart contracts covering token management, smart meter registration, grid tariffs, energy trading, and community batteries.

**Task 4 – Security, Privacy, and Performance Evaluation**

Threat modeling, automated security checks, privacy considerations, gas benchmarking, and scalability analysis.

**Task 5 – Legal, Ethical, and Societal Considerations**

Discussion of energy regulation, financial settlement considerations, household privacy, data protection, and responsible blockchain adoption.

**Task 6 – Deployment Roadmap and Critical Evaluation**

Proposed deployment phases, economic feasibility analysis, implementation limitations, and future development opportunities.

## 14. Future Enhancements

Potential future improvements include:

- Integration with physical IoT smart meters and solar inverters.
- Deployment on a suitable Layer-2 blockchain network.
- Advanced privacy-preserving verification mechanisms.
- AI-based energy demand forecasting.
- Automated battery charging and discharging optimization.
- Integration with real-world grid settlement infrastructure.
- Improved wallet onboarding and account abstraction.

## 15. Project Limitations

HeliosGrid is an engineering prototype designed to demonstrate blockchain-based peer-to-peer energy trading.

The current local environment uses a Hardhat blockchain for development and testing. It does not represent a live national electricity network.

Physical smart meter integration, actual grid interconnection, official regulatory approval, and production deployment require additional engineering, infrastructure, and authorization.

## 16. Documentation

For detailed technical and engineering information, refer to:

- **Consulting Engineering Report:** `docs/CONSULTING_ENGINEERING_REPORT.md`
- **Security Audit Report:** `docs/SECURITY_AUDIT_REPORT.md`
- **Static Analysis Results:** `docs/STATIC_ANALYSIS_REPORT.json`

These documents provide further details about the system design, engineering decisions, security evaluation, and project implementation.

---

## Conclusion

HeliosGrid demonstrates how blockchain technology can support decentralized energy trading through smart contracts, transparent pricing, automated settlements, and smart meter data verification.

By connecting local energy producers and consumers through a peer-to-peer marketplace, the project presents an approach to improving the management of distributed renewable energy resources.

The platform provides a foundation for exploring more transparent, efficient, and decentralized energy communities.
