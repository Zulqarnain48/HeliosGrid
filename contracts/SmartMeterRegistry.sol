// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @title SmartMeterRegistry
 * @dev Manages smart meter hardware identities, cryptographic attestations,
 * off-chain aggregated telemetry Merkle root anchors, and tamper detection.
 * Resolves the "thousands of readings per hour vs throughput" scalability conflict.
 */
contract SmartMeterRegistry is AccessControl {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");
    bytes32 public constant INSPECTOR_ROLE = keccak256("INSPECTOR_ROLE");

    enum MeterType { CONSUMER_ONLY, PROSUMER_SOLAR, BATTERY_PROSUMER }
    enum MeterStatus { INACTIVE, ACTIVE, SUSPENDED, TAMPER_FLAGGED }

    struct MeterProfile {
        uint256 meterId;
        address ownerResident;
        address deviceSignerAddress; // ECDSA public key / address burned in meter's Secure Element (HSM)
        MeterType meterType;
        MeterStatus status;
        uint32 maxInverterCapacityKW; // Peak inverter rating (e.g., 10 kW)
        uint256 cumulativeGenerationKWh;
        uint256 cumulativeConsumptionKWh;
        uint256 lastReadingTimestamp;
    }

    struct EpochTelemetryAnchor {
        uint256 epochId;
        bytes32 merkleRoot;
        uint256 totalSocietyGenerationKWh;
        uint256 totalSocietyConsumptionKWh;
        uint256 anchoredAtTimestamp;
        address submittedByOracle;
    }

    // Mapping: meterId => MeterProfile
    mapping(uint256 => MeterProfile) public meters;
    // Mapping: residentAddress => meterId
    mapping(address => uint256) public residentToMeterId;
    // Mapping: deviceSignerAddress => meterId
    mapping(address => uint256) public signerToMeterId;

    // Mapping: epochId => EpochTelemetryAnchor
    mapping(uint256 => EpochTelemetryAnchor) public epochAnchors;
    // Nonce tracking for direct signatures to prevent replay attacks
    mapping(uint256 => uint256) public meterNonces;

    uint256 public totalRegisteredMeters;
    uint256 public latestEpochId;

    event MeterRegistered(uint256 indexed meterId, address indexed owner, address indexed deviceSigner, MeterType meterType);
    event MeterStatusUpdated(uint256 indexed meterId, MeterStatus previousStatus, MeterStatus newStatus, string reason);
    event EpochAnchored(uint256 indexed epochId, bytes32 merkleRoot, uint256 totalGen, uint256 totalCon);
    event DirectReadingAttested(uint256 indexed meterId, uint256 deltaGen, uint256 deltaCon, uint256 newCumulativeGen, uint256 timestamp);
    event TamperAlert(uint256 indexed meterId, string alertType, uint256 observedValue, uint256 thresholdValue);

    constructor(address initialAdmin) {
        _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        _grantRole(ORACLE_ROLE, initialAdmin);
        _grantRole(INSPECTOR_ROLE, initialAdmin);
    }

    /**
     * @notice Register a new cryptographic smart meter
     */
    function registerMeter(
        uint256 meterId,
        address ownerResident,
        address deviceSignerAddress,
        MeterType meterType,
        uint32 maxInverterCapacityKW
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(meterId > 0, "Invalid meter ID");
        require(ownerResident != address(0), "Invalid owner");
        require(deviceSignerAddress != address(0), "Invalid signer");
        require(meters[meterId].meterId == 0, "Meter ID already registered");
        require(residentToMeterId[ownerResident] == 0, "Resident already has registered meter");
        require(signerToMeterId[deviceSignerAddress] == 0, "Signer key already assigned");

        meters[meterId] = MeterProfile({
            meterId: meterId,
            ownerResident: ownerResident,
            deviceSignerAddress: deviceSignerAddress,
            meterType: meterType,
            status: MeterStatus.ACTIVE,
            maxInverterCapacityKW: maxInverterCapacityKW,
            cumulativeGenerationKWh: 0,
            cumulativeConsumptionKWh: 0,
            lastReadingTimestamp: block.timestamp
        });

        residentToMeterId[ownerResident] = meterId;
        signerToMeterId[deviceSignerAddress] = meterId;
        totalRegisteredMeters++;

        emit MeterRegistered(meterId, ownerResident, deviceSignerAddress, meterType);
    }

    /**
     * @notice Anchors off-chain aggregated interval telemetry into a Merkle root.
     * Hundreds of thousands of raw readings per day are verified off-chain;
     * only the Merkle root is committed on-chain, scaling throughput massively.
     */
    function anchorEpochTelemetry(
        uint256 epochId,
        bytes32 merkleRoot,
        uint256 totalGenerationKWh,
        uint256 totalConsumptionKWh
    ) external onlyRole(ORACLE_ROLE) {
        require(epochAnchors[epochId].anchoredAtTimestamp == 0, "Epoch already anchored");
        require(merkleRoot != bytes32(0), "Empty Merkle root");

        epochAnchors[epochId] = EpochTelemetryAnchor({
            epochId: epochId,
            merkleRoot: merkleRoot,
            totalSocietyGenerationKWh: totalGenerationKWh,
            totalSocietyConsumptionKWh: totalConsumptionKWh,
            anchoredAtTimestamp: block.timestamp,
            submittedByOracle: msg.sender
        });

        if (epochId > latestEpochId) {
            latestEpochId = epochId;
        }

        emit EpochAnchored(epochId, merkleRoot, totalGenerationKWh, totalConsumptionKWh);
    }

    /**
     * @notice Cryptographically verifies a resident's specific 15-minute interval reading
     * against an anchored Merkle root. Resolves disputes without storing raw time-series on-chain.
     */
    function verifyIntervalReadingProof(
        uint256 epochId,
        uint256 meterId,
        uint256 deltaGenKWh,
        uint256 deltaConKWh,
        uint256 intervalTimestamp,
        bytes32[] calldata merkleProof
    ) external view returns (bool) {
        EpochTelemetryAnchor storage epoch = epochAnchors[epochId];
        require(epoch.anchoredAtTimestamp > 0, "Epoch does not exist");

        // Leaf calculation: keccak256(meterId, deltaGen, deltaCon, timestamp)
        bytes32 leaf = keccak256(
            bytes.concat(keccak256(abi.encode(meterId, deltaGenKWh, deltaConKWh, intervalTimestamp)))
        );

        return MerkleProof.verify(merkleProof, epoch.merkleRoot, leaf);
    }

    /**
     * @notice Submits a directly attested meter reading signed by the meter's Secure Element.
     * Includes automated physical anomaly detection (GIGO Defense).
     */
    function recordDirectMeterReading(
        uint256 meterId,
        uint256 deltaGenKWh,
        uint256 deltaConKWh,
        uint256 readingTimestamp,
        bytes calldata meterSignature
    ) external {
        MeterProfile storage profile = meters[meterId];
        require(profile.meterId > 0, "Meter not found");
        require(profile.status == MeterStatus.ACTIVE, "Meter not active");
        require(readingTimestamp > profile.lastReadingTimestamp, "Stale reading");

        uint256 nonce = meterNonces[meterId]++;
        bytes32 messageHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                meterId,
                deltaGenKWh,
                deltaConKWh,
                readingTimestamp,
                nonce
            )
        );

        bytes32 ethSignedMessageHash = messageHash.toEthSignedMessageHash();
        address recoveredSigner = ethSignedMessageHash.recover(meterSignature);
        require(recoveredSigner == profile.deviceSignerAddress, "Invalid meter hardware signature");

        // Physical Anomaly Check (GIGO Defense):
        uint256 elapsedSeconds = readingTimestamp - profile.lastReadingTimestamp;
        if (elapsedSeconds == 0) elapsedSeconds = 1;
        
        // Max theoretical kWh = inverter kW * 1e18 * seconds * 1.05 safety buffer / 3600
        if (profile.meterType != MeterType.CONSUMER_ONLY && profile.maxInverterCapacityKW > 0) {
            uint256 maxPossibleKWh = (uint256(profile.maxInverterCapacityKW) * 1e18 * elapsedSeconds * 105) / (3600 * 100);
            if (deltaGenKWh > maxPossibleKWh && maxPossibleKWh > 0) {
                profile.status = MeterStatus.TAMPER_FLAGGED;
                emit TamperAlert(meterId, "GenerationExceedsPhysicalCapacity", deltaGenKWh, maxPossibleKWh);
                emit MeterStatusUpdated(meterId, MeterStatus.ACTIVE, MeterStatus.TAMPER_FLAGGED, "Anomaly: Inverter over-generation");
                return;
            }
        }

        profile.cumulativeGenerationKWh += deltaGenKWh;
        profile.cumulativeConsumptionKWh += deltaConKWh;
        profile.lastReadingTimestamp = readingTimestamp;

        emit DirectReadingAttested(
            meterId,
            deltaGenKWh,
            deltaConKWh,
            profile.cumulativeGenerationKWh,
            readingTimestamp
        );
    }

    /**
     * @notice Allows designated inspectors to update meter status after on-site audit
     */
    function updateMeterStatus(
        uint256 meterId,
        MeterStatus newStatus,
        string calldata reason
    ) external onlyRole(INSPECTOR_ROLE) {
        require(meters[meterId].meterId > 0, "Meter not found");
        MeterStatus oldStatus = meters[meterId].status;
        meters[meterId].status = newStatus;
        emit MeterStatusUpdated(meterId, oldStatus, newStatus, reason);
    }

    function getMeter(uint256 meterId) external view returns (MeterProfile memory) {
        return meters[meterId];
    }
}
