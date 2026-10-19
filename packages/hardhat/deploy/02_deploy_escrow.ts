import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

const deployEscrow: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY) {
    throw new Error("Set __RUNTIME_DEPLOYER_PRIVATE_KEY in this terminal before deploying to POTOS.");
  }

  // Arbiter address provided by the user for this deployment.
  const arbiter = "0xFeA47b24F6336fc3a269D3Cb9e242FFe6A8a7320";
  if (!arbiter || !/^0x[a-fA-F0-9]{40}$/.test(arbiter)) {
    throw new Error("Configured arbiter address must be a 0x-prefixed 20-byte address.");
  }

  const { deployer } = await hre.getNamedAccounts();
  if (arbiter.toLowerCase() === deployer.toLowerCase()) {
    throw new Error("Configured arbiter must be a teammate other than the deployer.");
  }

  // Require the token deployment to exist on this network before deploying Escrow.
  await hre.deployments.get("HPSToken");

  const { deploy } = hre.deployments;
  await deploy("Escrow", {
    from: deployer,
    args: [arbiter],
    log: true,
    autoMine: true,
  });

  const escrow = await hre.ethers.getContract<Contract>("Escrow", deployer);
  console.log("Escrow address:", await escrow.getAddress());
  console.log("Escrow arbiter:", await escrow.arbiter());
};

export default deployEscrow;

// HPS is inferred from the symbol in HPSToken.sol; the numeric suffix is the student ID.
deployEscrow.tags = ["EscrowHPS202430550643"];
