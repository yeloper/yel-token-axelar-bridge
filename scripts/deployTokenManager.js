const hre = require("hardhat");
const crypto = require("crypto");
const { Contract } = require("ethers");
const { AxelarQueryAPI, Environment, EvmChain, GasToken } = require("@axelar-network/axelarjs-sdk");
const { IInterchainTokenService } = require("@axelar-network/axelar-local-dev/dist/contracts");

const MINT_BURN = 4; //This is mint burn;

const interchainTokenServiceContractAddress = "0xB5FB4BE02232B1bBA4dC8f81dc24C26980dE9e3C";
const yelToken = "0x949185D3BE66775Ea648F4a306740EA9eFF9C567";

async function getSigner() {
  const [signer] = await hre.ethers.getSigners();
  return signer;
}

async function getContractInstance(contractAddress, contractABI, signer) {
  return new hre.ethers.Contract(contractAddress, contractABI, signer);
}

async function deployTokenManagerLocal() {
  const signer = await getSigner();
  const its = new Contract(interchainTokenServiceContractAddress, IInterchainTokenService.abi, signer);
  const salt = "0x" + crypto.randomBytes(32).toString("hex");

  const params = hre.ethers.utils.defaultAbiCoder.encode(["bytes", "address"], [signer.address, yelToken]);
  await (await its.deployTokenManager(salt, "", MINT_BURN, params, 0)).wait();

  const tokenId = await its.interchainTokenId(signer.address, salt);
  const expectedTokenManagerAddress = await its.tokenManagerAddress(tokenId);

  console.log(
    `
      Salt: ${salt},
      Token ID: ${tokenId},
      Expected token manager address: ${expectedTokenManagerAddress},
      `
  );
  return { salt, tokenId, expectedTokenManagerAddress };
}

const api = new AxelarQueryAPI({ environment: Environment.TESTNET });

async function gasEstimator() {
  const gas = await api.estimateGasFee(EvmChain.AVALANCHE, EvmChain.POLYGON, 700000, 1.5);

  return gas;
}

async function deployRemoteTokenManager(salt, dstChain) {
  const signer = await getSigner();

  const interchainTokenServiceContract = await getContractInstance(interchainTokenServiceContractAddress, IInterchainTokenService.abi, signer);
  const param = hre.ethers.utils.defaultAbiCoder.encode(["bytes", "address"], [signer.address, yelToken]);

  const gasAmount = await gasEstimator(); //TODO: CHANGE CHAINS

  const its = new Contract(interchainTokenServiceContractAddress, IInterchainTokenService.abi, signer);
  const deployTxData = await (await its.deployTokenManager(salt, dstChain, MINT_BURN, param, 0, { value: gasAmount })).wait();

  const tokenId = await interchainTokenServiceContract.interchainTokenId(signer.address, salt);

  const expectedTokenManagerAddress = await interchainTokenServiceContract.tokenManagerAddress(tokenId);

  console.log(
    `
      Transaction Hash: ${deployTxData.hash},
      Token ID: ${tokenId},
      Expected token manager address: ${expectedTokenManagerAddress},
      `
  );
}

async function transferMintAccessToTokenManager(expectedTokenManagerAddress) {
  const signer = await getSigner();

  const tokenContract = await getContractInstance(yelToken, customTokenABI, signer);
  const getMinterRole = await tokenContract.MINTER_ROLE();
  const grantRoleTxn = await tokenContract.grantRole(getMinterRole, expectedTokenManagerAddress);

  console.log("grantRoleTxn: ", grantRoleTxn.hash);
}

async function transferTokens(tokenId) {
  const signer = await getSigner();

  const interchainTokenServiceContract = await getContractInstance(interchainTokenServiceContractAddress, IInterchainTokenService.abi, signer);
  const gasAmount = await gasEstimator();

  const transfer = await interchainTokenServiceContract.interchainTransfer(
    tokenId, // tokenId, the one you store in the earlier step
    "Polygon",
    signer.address, // receiver address
    ethers.parseUnits("0.001", "ether"), // amount of token to transfer
    "0x",
    0, // gasValue
    {
      value: gasAmount,
    }
  );

  console.log("Transfer Transaction Hash:", transfer.hash);
}

async function main() {
  const dstChain = "Polygon";
  const { salt, tokenId, expectedTokenManagerAddress } = await deployTokenManagerLocal();
  await deployRemoteTokenManager(salt, dstChain);
  await transferMintAccessToTokenManager(expectedTokenManagerAddress);

  //transfer test
  await transferTokens(tokenId);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
