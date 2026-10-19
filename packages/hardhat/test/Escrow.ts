import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";

const AMOUNT = ethers.parseUnits("30", 18);
const BUYER_INITIAL_BALANCE = ethers.parseUnits("100", 18);

async function deployFixture() {
  const [, buyer, seller, arbiter, stranger] = await ethers.getSigners();

  const token = await ethers.deployContract("HPSToken");
  await token.waitForDeployment();
  await token.mint(buyer.address, BUYER_INITIAL_BALANCE);

  const escrow = await ethers.deployContract("Escrow", [arbiter.address]);
  await escrow.waitForDeployment();

  const deadline = (await time.latest()) + 3600;

  return { token, escrow, buyer, seller, arbiter, stranger, deadline };
}

type EscrowFixture = Awaited<ReturnType<typeof deployFixture>>;
type CreateOrderFixture = Pick<EscrowFixture, "escrow" | "buyer" | "seller" | "token" | "deadline">;

async function createOrder({ escrow, buyer, seller, token, deadline }: CreateOrderFixture) {
  return escrow.connect(buyer).createOrder(seller.address, await token.getAddress(), AMOUNT, deadline, "实验3订单");
}

describe("Escrow", function () {
  it("createOrder 记录订单并发出事件", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    const tokenAddress = await token.getAddress();

    await expect(createOrder({ escrow, buyer, seller, token, deadline }))
      .to.emit(escrow, "OrderCreated")
      .withArgs(0n, buyer.address, seller.address, tokenAddress, AMOUNT, BigInt(deadline));

    const order = await escrow.getOrder(0);
    expect(order.buyer).to.equal(buyer.address);
    expect(order.seller).to.equal(seller.address);
    expect(order.token).to.equal(tokenAddress);
    expect(order.amount).to.equal(AMOUNT);
    expect(order.deadline).to.equal(BigInt(deadline));
    expect(order.status).to.equal(0n);
    expect(await escrow.orderCount()).to.equal(1n);
  });

  it("未 approve 时 deposit 失败", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });

    await expect(escrow.connect(buyer).deposit(0)).to.be.revertedWith("Insufficient allowance");
    expect((await escrow.getOrder(0)).status).to.equal(0n);
  });

  it("approve 后 deposit 成功，代币进入 Escrow，状态变为 Paid", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    const escrowAddress = await escrow.getAddress();
    await createOrder({ escrow, buyer, seller, token, deadline });

    await token.connect(buyer).approve(escrowAddress, AMOUNT);
    await expect(escrow.connect(buyer).deposit(0)).to.emit(escrow, "OrderPaid").withArgs(0n);

    expect((await escrow.getOrder(0)).status).to.equal(1n);
    expect(await token.balanceOf(escrowAddress)).to.equal(AMOUNT);
    expect(await token.balanceOf(buyer.address)).to.equal(BUYER_INITIAL_BALANCE - AMOUNT);
  });

  it("非买家调用 confirm 失败", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(seller).confirm(0)).to.be.revertedWith("Escrow: caller is not the buyer");
  });

  it("confirm 后卖家收到代币，状态变为 Completed", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(buyer).confirm(0)).to.emit(escrow, "OrderCompleted").withArgs(0n);

    expect((await escrow.getOrder(0)).status).to.equal(2n);
    expect(await token.balanceOf(seller.address)).to.equal(AMOUNT);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("deadline 之前 refund 失败，deadline 之后 refund 成功并退回买家", async function () {
    const { token, escrow, buyer, seller, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);

    await expect(escrow.connect(buyer).refund(0)).to.be.revertedWith("Escrow: deadline not reached");

    await time.increaseTo(deadline + 1);
    await expect(escrow.connect(buyer).refund(0)).to.emit(escrow, "OrderRefunded").withArgs(0n);

    expect((await escrow.getOrder(0)).status).to.equal(3n);
    expect(await token.balanceOf(buyer.address)).to.equal(BUYER_INITIAL_BALANCE);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
  });

  it("非仲裁人调用 resolve 失败", async function () {
    const { token, escrow, buyer, seller, stranger, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);
    await escrow.connect(buyer).dispute(0);

    await expect(escrow.connect(stranger).resolve(0, false)).to.be.revertedWith("Escrow: caller is not the arbiter");
  });

  it("dispute 后仲裁人 resolve(false) 退款给买家，状态变为 Refunded", async function () {
    const { token, escrow, buyer, seller, arbiter, deadline } = await loadFixture(deployFixture);
    await createOrder({ escrow, buyer, seller, token, deadline });
    await token.connect(buyer).approve(await escrow.getAddress(), AMOUNT);
    await escrow.connect(buyer).deposit(0);
    await escrow.connect(seller).dispute(0);

    await expect(escrow.connect(arbiter).resolve(0, false)).to.emit(escrow, "OrderResolved").withArgs(0n, false);

    expect((await escrow.getOrder(0)).status).to.equal(3n);
    expect(await token.balanceOf(buyer.address)).to.equal(BUYER_INITIAL_BALANCE);
    expect(await token.balanceOf(await escrow.getAddress())).to.equal(0n);
  });
});
