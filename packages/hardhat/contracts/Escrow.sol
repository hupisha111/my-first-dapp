// SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

/// @notice The ERC20 functions used by the escrow.
interface IERC20 {
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract Escrow {
    enum Status {
        Created,
        Paid,
        Completed,
        Refunded,
        Disputed
    }

    struct Order {
        address buyer;
        address seller;
        address token;
        uint256 amount;
        uint256 deadline;
        Status status;
        string description;
    }

    address public arbiter;
    uint256 public orderCount;
    mapping(uint256 => Order) private _orders;

    event OrderCreated(
        uint256 indexed id,
        address indexed buyer,
        address indexed seller,
        address token,
        uint256 amount,
        uint256 deadline
    );
    event OrderPaid(uint256 indexed id);
    event OrderCompleted(uint256 indexed id);
    event OrderRefunded(uint256 indexed id);
    event OrderDisputed(uint256 indexed id, address by);
    event OrderResolved(uint256 indexed id, bool sellerWins);

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "Escrow: caller is not the arbiter");
        _;
    }

    modifier onlyBuyer(uint256 id) {
        require(msg.sender == _orders[id].buyer, "Escrow: caller is not the buyer");
        _;
    }

    modifier inStatus(uint256 id, Status expected) {
        require(_orders[id].status == expected, "Escrow: wrong status");
        _;
    }

    constructor(address _arbiter) {
        require(_arbiter != address(0), "Escrow: arbiter is the zero address");
        arbiter = _arbiter;
    }

    function getOrder(uint256 id) public view returns (Order memory) {
        require(id < orderCount, "Escrow: order does not exist");
        return _orders[id];
    }

    function createOrder(
        address seller,
        address token,
        uint256 amount,
        uint256 deadline,
        string memory description
    ) public returns (uint256) {
        require(seller != address(0), "Escrow: seller is the zero address");
        require(seller != msg.sender, "Escrow: buyer cannot be the seller");
        require(token != address(0), "Escrow: token is the zero address");
        require(amount > 0, "Escrow: amount must be greater than zero");
        require(deadline > block.timestamp, "Escrow: deadline must be in the future");

        uint256 id = orderCount;
        _orders[id] = Order({
            buyer: msg.sender,
            seller: seller,
            token: token,
            amount: amount,
            deadline: deadline,
            status: Status.Created,
            description: description
        });
        orderCount = id + 1;

        emit OrderCreated(id, msg.sender, seller, token, amount, deadline);
        return id;
    }

    function deposit(uint256 id)
        public
        onlyBuyer(id)
        inStatus(id, Status.Created)
    {
        Order storage order = _orders[id];

        // Checks-effects-interactions: set state before calling the token contract.
        order.status = Status.Paid;
        bool success = IERC20(order.token).transferFrom(
            order.buyer,
            address(this),
            order.amount
        );
        require(success, "Escrow: token transfer failed");

        emit OrderPaid(id);
    }

    function confirm(uint256 id)
        public
        onlyBuyer(id)
        inStatus(id, Status.Paid)
    {
        Order storage order = _orders[id];

        order.status = Status.Completed;
        bool success = IERC20(order.token).transfer(order.seller, order.amount);
        require(success, "Escrow: token transfer failed");

        emit OrderCompleted(id);
    }

    function refund(uint256 id)
        public
        onlyBuyer(id)
        inStatus(id, Status.Paid)
    {
        require(block.timestamp > _orders[id].deadline, "Escrow: deadline not reached");

        Order storage order = _orders[id];
        order.status = Status.Refunded;
        bool success = IERC20(order.token).transfer(order.buyer, order.amount);
        require(success, "Escrow: token transfer failed");

        emit OrderRefunded(id);
    }

    function dispute(uint256 id) public inStatus(id, Status.Paid) {
        Order storage order = _orders[id];
        require(
            msg.sender == order.buyer || msg.sender == order.seller,
            "Escrow: caller is neither buyer nor seller"
        );

        order.status = Status.Disputed;
        emit OrderDisputed(id, msg.sender);
    }

    function resolve(uint256 id, bool sellerWins)
        public
        onlyArbiter
        inStatus(id, Status.Disputed)
    {
        Order storage order = _orders[id];

        // Record the final state before transferring tokens out of the escrow.
        if (sellerWins) {
            order.status = Status.Completed;
            bool success = IERC20(order.token).transfer(order.seller, order.amount);
            require(success, "Escrow: token transfer failed");
        } else {
            order.status = Status.Refunded;
            bool success = IERC20(order.token).transfer(order.buyer, order.amount);
            require(success, "Escrow: token transfer failed");
        }

        emit OrderResolved(id, sellerWins);
    }
}