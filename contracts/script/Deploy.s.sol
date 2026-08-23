// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {HealthInsurancePolicy} from "../src/HealthInsurancePolicy.sol";
import {ClaimVerifier} from "../src/ClaimVerifier.sol";
import {Groth16Verifier} from "../src/verifier/ClaimProofVerifier.sol";
import {MockAggregatorV3} from "../mocks/MockAggregatorV3.sol";

/// @title ProofSure deployment
///
/// Local demo (default):
///   anvil &  && forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast
///   -> deploys MockAggregatorV3 (300,000 INR/ETH) + real Groth16 ClaimVerifier + policy
///
/// Sepolia (real Chainlink feed optional):
///   export DEPLOYER_PRIVATE_KEY=... SEPOLIA_RPC_URL=... PRICE_FEED=0x...   # 0 = mock
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80));
        address priceFeed = vm.envOr("PRICE_FEED", address(0));

        vm.startBroadcast(deployerKey);

        MockAggregatorV3 mockFeed;
        if (priceFeed == address(0)) {
            // local/demo: 300,000 INR per ETH, 8 decimals
            mockFeed = new MockAggregatorV3(300000e8, 8);
            priceFeed = address(mockFeed);
        }

        // Real Groth16 verifier for claim.circom (drop-in snarkjs artifact)
        Groth16Verifier groth16 = new Groth16Verifier();
        ClaimVerifier claimVerifier = new ClaimVerifier();

        HealthInsurancePolicy policy = new HealthInsurancePolicy(address(claimVerifier), priceFeed);

        // Authorize hospital BabyJubJub keys:
        //  - canonical deterministic HOSP001 demo key (circuits/claim-zk/test_vectors/hospital_keys.json)
        //  - the frozen known-good vector key (test_vectors/claim_public.json) for Remix/vector demos
        uint256[] memory xs = new uint256[](2);
        uint256[] memory ys = new uint256[](2);
        xs[0] = 14356436510628464141481276967685016350161420144463377789029479592270911206734;
        ys[0] = 2095218806682237529603165301270652933457510815089531564992792826502866980454;
        xs[1] = 6581781790582791676866385184842367664603665639125448719263921209915667713006;
        ys[1] = 19099797786266514037329521559976600218901144494217183839938780509263153667721;
        policy.authorizeHospitalsByKey(xs, ys);

        // seed reserve from broadcaster
        policy.fundReserve{value: 10 ether}();

        vm.stopBroadcast();

        console2.log("=== ProofSure deployment ===");
        console2.log("PriceFeed (INR/ETH):", priceFeed);
        console2.log("Groth16Verifier    :", address(groth16));
        console2.log("ClaimVerifier      :", address(claimVerifier));
        console2.log("HealthInsurancePolicy:", address(policy));
        vm.writeFile("deployment.json", string.concat(
            '{"priceFeed":"', vm.toString(priceFeed),
            '","groth16Verifier":"', vm.toString(address(groth16)),
            '","claimVerifier":"', vm.toString(address(claimVerifier)),
            '","policy":"', vm.toString(address(policy)), '"}'
        ));
    }
}
