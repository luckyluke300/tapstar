// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title  TapStarArenaV4
 * @notice PvP color-invasion game vault with withdrawal cooldown.
 *
 * V4 changes vs V3:
 *  - Added WITHDRAW_COOLDOWN (5 minutes). After any balance-affecting
 *    activity (deposit, settleMatch, refundMatch), the player must wait
 *    before withdrawing. This prevents the "loser front-runs settlement"
 *    exploit where a loser calls withdraw() before settleMatch lands,
 *    causing settlement to revert and dodging the loss.
 *  - Owner can adjust the cooldown via setCooldown() (capped at 1 hour).
 *  - Emergency withdrawals (owner-triggered) bypass the cooldown for
 *    contract migration scenarios.
 */
contract TapStarArenaV4 is EIP712, ReentrancyGuard, Ownable, Pausable {
    using ECDSA for bytes32;

    // ============================================================
    //                          CONSTANTS
    // ============================================================

    bytes32 private constant MATCH_TYPEHASH = keccak256(
        "MatchResult(bytes32 matchId,address winner,address loser,uint256 stake,uint256 deadline)"
    );

    bytes32 private constant REFUND_TYPEHASH = keccak256(
        "MatchRefund(bytes32 matchId,address p1,address p2,uint256 stake,uint256 deadline)"
    );

    uint16  public constant MAX_HOUSE_FEE_BPS = 1000;
    uint256 public constant MAX_COOLDOWN      = 1 hours;

    // ============================================================
    //                            STATE
    // ============================================================

    mapping(address => uint256) public balances;
    mapping(bytes32 => bool)    public settledMatches;
    mapping(address => uint256) public lastActivity;   // V4: cooldown anchor

    address public resultSigner;
    address public treasury;
    uint16  public houseFeeBps;
    uint256 public minStake;
    uint256 public maxStake;
    uint256 public withdrawCooldown;                   // V4: seconds

    // ============================================================
    //                            EVENTS
    // ============================================================

    event Deposited(address indexed user, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed user, uint256 amount, uint256 newBalance);
    event MatchSettled(
        bytes32 indexed matchId,
        address indexed winner,
        address indexed loser,
        uint256 stake,
        uint256 winnerPayout,
        uint256 fee
    );
    event MatchRefunded(
        bytes32 indexed matchId,
        address indexed p1,
        address indexed p2,
        uint256 stake
    );
    event SignerUpdated(address oldSigner, address newSigner);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event HouseFeeUpdated(uint16 oldFeeBps, uint16 newFeeBps);
    event StakeLimitsUpdated(uint256 minStake, uint256 maxStake);
    event CooldownUpdated(uint256 oldCooldown, uint256 newCooldown);

    // ============================================================
    //                         CONSTRUCTOR
    // ============================================================

    constructor(address _resultSigner, address _treasury)
        EIP712("TapStarArena", "1")
        Ownable(msg.sender)
    {
        require(_resultSigner != address(0), "signer=0");
        require(_treasury != address(0), "treasury=0");
        resultSigner     = _resultSigner;
        treasury         = _treasury;
        houseFeeBps      = 1000;          // 10%
        minStake         = 0.0001 ether;
        maxStake         = 10 ether;
        withdrawCooldown = 300;           // 5 minutes
    }

    // ============================================================
    //                        USER FUNCTIONS
    // ============================================================

    function deposit() external payable nonReentrant whenNotPaused {
        require(msg.value > 0, "amount=0");
        balances[msg.sender] += msg.value;
        lastActivity[msg.sender] = block.timestamp;
        emit Deposited(msg.sender, msg.value, balances[msg.sender]);
    }

    function withdraw(uint256 amount) external nonReentrant {
        require(amount > 0, "amount=0");
        require(
            block.timestamp >= lastActivity[msg.sender] + withdrawCooldown,
            "cooldown active"
        );
        uint256 bal = balances[msg.sender];
        require(bal >= amount, "insufficient");
        balances[msg.sender] = bal - amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount, balances[msg.sender]);
    }

    function withdrawAll() external nonReentrant {
        require(
            block.timestamp >= lastActivity[msg.sender] + withdrawCooldown,
            "cooldown active"
        );
        uint256 bal = balances[msg.sender];
        require(bal > 0, "amount=0");
        balances[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: bal}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, bal, 0);
    }

    /**
     * @notice Settle a match — winner takes pot minus house fee.
     */
    function settleMatch(
        bytes32 matchId,
        address winner,
        address loser,
        uint256 stake,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(block.timestamp <= deadline, "expired");
        require(!settledMatches[matchId], "already settled");
        require(winner != address(0) && loser != address(0), "zero addr");
        require(winner != loser, "same player");
        require(stake >= minStake && stake <= maxStake, "stake range");
        require(balances[winner] >= stake, "winner balance");
        require(balances[loser]  >= stake, "loser balance");

        bytes32 structHash = keccak256(abi.encode(
            MATCH_TYPEHASH, matchId, winner, loser, stake, deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        require(digest.recover(signature) == resultSigner, "bad signature");

        settledMatches[matchId] = true;

        uint256 pot          = stake * 2;
        uint256 fee          = (pot * houseFeeBps) / 10000;
        uint256 winnerPayout = pot - fee;

        balances[loser]  -= stake;
        balances[winner]  = balances[winner] - stake + winnerPayout;

        // Reset cooldown for both players
        lastActivity[winner] = block.timestamp;
        lastActivity[loser]  = block.timestamp;

        (bool ok, ) = treasury.call{value: fee}("");
        require(ok, "fee transfer failed");

        emit MatchSettled(matchId, winner, loser, stake, winnerPayout, fee);
    }

    /**
     * @notice Refund both players for a disputed or abandoned match.
     */
    function refundMatch(
        bytes32 matchId,
        address p1,
        address p2,
        uint256 stake,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused {
        require(block.timestamp <= deadline, "expired");
        require(!settledMatches[matchId], "already settled");
        require(p1 != address(0) && p2 != address(0), "zero addr");
        require(p1 != p2, "same player");
        require(stake >= minStake && stake <= maxStake, "stake range");

        bytes32 structHash = keccak256(abi.encode(
            REFUND_TYPEHASH, matchId, p1, p2, stake, deadline
        ));
        bytes32 digest = _hashTypedDataV4(structHash);
        require(digest.recover(signature) == resultSigner, "bad signature");

        settledMatches[matchId] = true;

        // Reset cooldown for both players
        lastActivity[p1] = block.timestamp;
        lastActivity[p2] = block.timestamp;

        emit MatchRefunded(matchId, p1, p2, stake);
    }

    // ============================================================
    //                        OWNER FUNCTIONS
    // ============================================================

    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "signer=0");
        emit SignerUpdated(resultSigner, newSigner);
        resultSigner = newSigner;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        require(newTreasury != address(0), "treasury=0");
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setHouseFee(uint16 newFeeBps) external onlyOwner {
        require(newFeeBps <= MAX_HOUSE_FEE_BPS, "fee too high");
        emit HouseFeeUpdated(houseFeeBps, newFeeBps);
        houseFeeBps = newFeeBps;
    }

    function setStakeLimits(uint256 _minStake, uint256 _maxStake) external onlyOwner {
        require(_minStake > 0 && _maxStake >= _minStake, "bad range");
        minStake = _minStake;
        maxStake = _maxStake;
        emit StakeLimitsUpdated(_minStake, _maxStake);
    }

    function setCooldown(uint256 newCooldown) external onlyOwner {
        require(newCooldown <= MAX_COOLDOWN, "too long");
        emit CooldownUpdated(withdrawCooldown, newCooldown);
        withdrawCooldown = newCooldown;
    }

    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ============================================================
    //                          VIEWS
    // ============================================================

    function getMatchDigest(
        bytes32 matchId, address winner, address loser, uint256 stake, uint256 deadline
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            MATCH_TYPEHASH, matchId, winner, loser, stake, deadline
        )));
    }

    function getRefundDigest(
        bytes32 matchId, address p1, address p2, uint256 stake, uint256 deadline
    ) external view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            REFUND_TYPEHASH, matchId, p1, p2, stake, deadline
        )));
    }

    /// @notice Seconds remaining before a user can withdraw (0 = ready).
    function cooldownRemaining(address user) external view returns (uint256) {
        uint256 unlockAt = lastActivity[user] + withdrawCooldown;
        if (block.timestamp >= unlockAt) return 0;
        return unlockAt - block.timestamp;
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function contractBalance() external view returns (uint256) {
        return address(this).balance;
    }

    receive() external payable { revert("use deposit()"); }
}
