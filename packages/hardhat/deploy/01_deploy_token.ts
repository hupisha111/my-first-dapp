import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { Contract } from "ethers";

const deployToken: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  if (!process.env.__RUNTIME_DEPLOYER_PRIVATE_KEY) {
    throw new Error("Set __RUNTIME_DEPLOYER_PRIVATE_KEY in this terminal before deploying to POTOS.");
  }

  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  await deploy("HPSToken", {
    from: deployer,
    args: [],
    log: true,
    autoMine: true,
  });

  const token = await hre.ethers.getContract<Contract>("HPSToken", deployer);
  console.log("HPSToken address:", await token.getAddress());
  console.log("HPSToken symbol:", await token.symbol());
};

export default deployToken;

// HPS is inferred from the symbol in HPSToken.sol; the numeric suffix is the student ID.
deployToken.tags = ["TokenHPS202430550643"];
