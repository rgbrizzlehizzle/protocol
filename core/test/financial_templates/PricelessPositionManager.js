const { didContractThrow } = require("../../../common/SolidityTestUtils.js");
const PricelessPositionManager = artifacts.require("PricelessPositionManager");
const Token = artifacts.require("Token");

// Helper Contracts
const ERC20MintableData = require("@openzeppelin/contracts/build/contracts/ERC20Mintable.json");
const truffleContract = require("@truffle/contract");
const ERC20Mintable = truffleContract(ERC20MintableData);
ERC20Mintable.setProvider(web3.currentProvider);

contract("PricelessPositionManager", function(accounts) {
  const { toBN, toWei } = web3.utils;
  const sponsor = accounts[0];
  const other = accounts[1];
  const collateralOwner = accounts[2];

  const withdrawalLiveness = 1000;
  let collateral;
  let pricelessPositionManager;
  let tokenCurrency;

  const initialPositionTokens = toBN(toWei("1000"));
  const initialPositionCollateral = toBN(toWei("1"));
  const checkBalances = async (expectedSponsorTokens, expectedSponsorCollateral) => {
    const expectedTotalTokens = expectedSponsorTokens.add(initialPositionTokens);
    const expectedTotalCollateral = expectedSponsorCollateral.add(initialPositionCollateral);

    const positionData = await pricelessPositionManager.positions(sponsor);
    assert.equal(positionData.isValid, true);
    assert.equal(positionData.collateral.toString(), expectedSponsorCollateral.toString());
    assert.equal(positionData.tokensOutstanding.toString(), expectedSponsorTokens.toString());
    assert.equal((await tokenCurrency.balanceOf(sponsor)).toString(), expectedSponsorTokens.toString());

    assert.equal(
      (await pricelessPositionManager.totalPositionCollateral()).toString(),
      expectedTotalCollateral.toString()
    );
    assert.equal((await pricelessPositionManager.totalTokensOutstanding()).toString(), expectedTotalTokens.toString());
    assert.equal(await collateral.balanceOf(pricelessPositionManager.address), expectedTotalCollateral.toString());
  };

  before(async function() {
    // Represents DAI or some other token that the sponsor and contracts don't control.
    collateral = await ERC20Mintable.new({ from: collateralOwner });
    await collateral.mint(sponsor, toWei("1000000"), { from: collateralOwner });
    await collateral.mint(other, toWei("1000000"), { from: collateralOwner });
  });

  beforeEach(async function() {
    // The contract expires 10k seconds in the future -> will not expire during this test case.
    const expirationTimestamp = Math.floor(Date.now() / 1000) + 10000;
    pricelessPositionManager = await PricelessPositionManager.new(
      expirationTimestamp,
      withdrawalLiveness,
      collateral.address,
      true
    );
    tokenCurrency = await Token.at(await pricelessPositionManager.tokenCurrency());
  });

  it("Lifecycle", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    // Create the initial pricelessPositionManager.
    const createTokens = toWei("100");
    const createCollateral = toWei("150");
    let expectedSponsorTokens = toBN(createTokens);
    let expectedSponsorCollateral = toBN(createCollateral);
    // Fails without approving collateral.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: createCollateral }, { rawValue: createTokens }, { from: sponsor })
      )
    );
    await collateral.approve(pricelessPositionManager.address, createCollateral, { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: createCollateral },
      { rawValue: createTokens },
      { from: sponsor }
    );
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Deposit.
    const depositCollateral = toWei("50");
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(depositCollateral));
    // Fails without approving collateral.
    assert(
      await didContractThrow(pricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor }))
    );
    await collateral.approve(pricelessPositionManager.address, depositCollateral, { from: sponsor });
    await pricelessPositionManager.deposit({ rawValue: depositCollateral }, { from: sponsor });
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Withdraw.
    const withdrawCollateral = toWei("20");
    expectedSponsorCollateral = expectedSponsorCollateral.sub(toBN(withdrawCollateral));
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.withdraw({ rawValue: withdrawCollateral }, { from: sponsor });
    let sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), withdrawCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem 50% of the tokens for 50% of the collateral.
    const redeemTokens = toWei("50");
    expectedSponsorTokens = expectedSponsorTokens.sub(toBN(redeemTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.divn(2);
    // Fails without approving token.
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: redeemTokens }, { from: sponsor })));
    await tokenCurrency.approve(pricelessPositionManager.address, redeemTokens, { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.redeem({ rawValue: redeemTokens }, { from: sponsor });
    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Create additional.
    const createAdditionalTokens = toWei("10");
    const createAdditionalCollateral = toWei("110");
    expectedSponsorTokens = expectedSponsorTokens.add(toBN(createAdditionalTokens));
    expectedSponsorCollateral = expectedSponsorCollateral.add(toBN(createAdditionalCollateral));
    await collateral.approve(pricelessPositionManager.address, createAdditionalCollateral, { from: sponsor });
    await pricelessPositionManager.create(
      { rawValue: createAdditionalCollateral },
      { rawValue: createAdditionalTokens },
      { from: sponsor }
    );
    await checkBalances(expectedSponsorTokens, expectedSponsorCollateral);

    // Redeem full.
    const redeemRemainingTokens = toWei("60");
    await tokenCurrency.approve(pricelessPositionManager.address, redeemRemainingTokens, { from: sponsor });
    sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.redeem({ rawValue: redeemRemainingTokens }, { from: sponsor });
    sponsorFinalBalance = await collateral.balanceOf(sponsor);
    assert.equal(sponsorFinalBalance.sub(sponsorInitialBalance).toString(), expectedSponsorCollateral);
    await checkBalances(toBN("0"), toBN("0"));
  });

  it("Withdrawal request", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    const startTime = await pricelessPositionManager.getCurrentTime();
    // Approve large amounts of token and collateral currencies: this test case isn't checking for that.
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Create the initial pricelessPositionManager.
    const initialSponsorTokens = toWei("100");
    const initialSponsorCollateral = toWei("150");
    await pricelessPositionManager.create(
      { rawValue: initialSponsorCollateral },
      { rawValue: initialSponsorTokens },
      { from: sponsor }
    );

    // Request withdrawal.
    await pricelessPositionManager.requestWithdrawal({ rawValue: toWei("100") }, { from: sponsor });

    // All other actions are locked.
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: toWei("1") }, { from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );

    // Can't withdraw before time is up.
    await pricelessPositionManager.setCurrentTime(startTime.toNumber() + withdrawalLiveness - 1);
    assert(await didContractThrow(pricelessPositionManager.withdrawPassedRequest({ from: sponsor })));

    // The price moved against the sponsor, and they need to cancel.
    await pricelessPositionManager.cancelWithdrawal({ from: sponsor });
    // They can now request again.
    const withdrawalAmount = toWei("25");
    const expectedSponsorCollateral = toBN(initialSponsorCollateral).sub(toBN(withdrawalAmount));
    await pricelessPositionManager.requestWithdrawal({ rawValue: withdrawalAmount }, { from: sponsor });

    // Can withdraw after time is up.
    await pricelessPositionManager.setCurrentTime(
      (await pricelessPositionManager.getCurrentTime()).toNumber() + withdrawalLiveness + 1
    );
    let sponsorInitialBalance = await collateral.balanceOf(sponsor);
    await pricelessPositionManager.withdrawPassedRequest({ from: sponsor });
    let sponsorFinalBalance = await collateral.balanceOf(sponsor);

    // Verify state of pricelessPositionManager post-withdrawal.
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Methods are now unlocked again.
    await pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor });
    await pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("125") }, { rawValue: toWei("100") }, { from: sponsor });
    await pricelessPositionManager.redeem({ rawValue: toWei("100") }, { from: sponsor });
    await checkBalances(toBN(initialSponsorTokens), expectedSponsorCollateral);

    // Can't cancel if no withdrawals pending.
    assert(await didContractThrow(pricelessPositionManager.cancelWithdrawal({ from: sponsor })));
  });

  it("Global collateralization ratio checks", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: other });

    // Create the initial pricelessPositionManager, with a 150% collateralization ratio.
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });

    // Any withdrawal requests should fail, because withdrawals would reduce the global collateralization ratio.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // A new pricelessPositionManager can't be created below the global ratio.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: sponsor })
      )
    );
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("101") }, { from: other })
      )
    );

    // A new pricelessPositionManager CAN be expanded or created above the global ratio.
    await pricelessPositionManager.create({ rawValue: toWei("15") }, { rawValue: toWei("10") }, { from: sponsor });
    await pricelessPositionManager.create({ rawValue: toWei("25") }, { rawValue: toWei("10") }, { from: other });

    // Can't withdraw below global ratio.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));

    // For the "other" pricelessPositionManager:
    // global collateralization ratio = (150 + 15 + 25) / (100 + 10 + 10) = 1.58333
    // To maintain 10 tokens, need at least 15.833 collateral => can withdraw from 25 down to 16 but not to 15.
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("10") }, { from: other })));
    await pricelessPositionManager.withdraw({ rawValue: toWei("9") }, { from: other });
  });

  it("Transfer", async function() {
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Create the initial pricelessPositionManager.
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });
    assert.equal((await pricelessPositionManager.positions(sponsor)).collateral.toString(), amountCollateral);
    assert.equal((await pricelessPositionManager.positions(other)).collateral.toString(), toWei("0"));

    // Transfer.
    await pricelessPositionManager.transfer(other, { from: sponsor });
    assert.equal((await pricelessPositionManager.positions(sponsor)).collateral.toString(), toWei("0"));
    assert.equal((await pricelessPositionManager.positions(other)).collateral.toString(), amountCollateral);

    // Can't transfer if the target already has a pricelessPositionManager.
    await pricelessPositionManager.create({ rawValue: toWei("150") }, { rawValue: toWei("100") }, { from: sponsor });
    assert(await didContractThrow(pricelessPositionManager.transfer(other, { from: sponsor })));
  });

  it("Frozen post expiry", async function() {
    // TODO: This test case is a placeholder until we implement the full expiration logic.

    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    const numTokens = toWei("100");
    const amountCollateral = toWei("150");
    await pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor });

    const expirationTime = await pricelessPositionManager.expirationTimestamp();
    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() - 1);

    // Even though the contract isn't expired yet, can't issue a withdrawal request past the expiration time.
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );

    await pricelessPositionManager.setCurrentTime(expirationTime.toNumber() + 1);

    // All method calls should revert.
    assert(
      await didContractThrow(
        pricelessPositionManager.create({ rawValue: amountCollateral }, { rawValue: numTokens }, { from: sponsor })
      )
    );
    assert(await didContractThrow(pricelessPositionManager.withdraw({ rawValue: toWei("1") }, { from: sponsor })));
    assert(
      await didContractThrow(pricelessPositionManager.requestWithdrawal({ rawValue: toWei("1") }, { from: sponsor }))
    );
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));
    assert(await didContractThrow(pricelessPositionManager.transfer(accounts[3], { from: sponsor })));
  });

  it("Non sponsor can't deposit or redeem", async function() {
    // Create an initial large and lowly collateralized pricelessPositionManager.
    await collateral.approve(pricelessPositionManager.address, initialPositionCollateral, { from: other });
    await pricelessPositionManager.create(
      { rawValue: initialPositionCollateral.toString() },
      { rawValue: initialPositionTokens.toString() },
      { from: other }
    );

    await tokenCurrency.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("100000"), { from: sponsor });

    // Can't deposit without first creating a pricelessPositionManager.
    assert(await didContractThrow(pricelessPositionManager.deposit({ rawValue: toWei("1") }, { from: sponsor })));

    // Even if the "sponsor" acquires a token somehow, they can't redeem.
    await tokenCurrency.transfer(sponsor, toWei("1"), { from: other });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: toWei("1") }, { from: sponsor })));
  });

  it("Can't redeem more than pricelessPositionManager size", async function() {
    await tokenCurrency.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: other });
    await collateral.approve(pricelessPositionManager.address, toWei("1000"), { from: sponsor });

    const numTokens = toWei("1");
    const numCombinedTokens = toWei("2");
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: other });
    await pricelessPositionManager.create({ rawValue: toWei("1") }, { rawValue: numTokens }, { from: sponsor });

    await tokenCurrency.transfer(sponsor, numTokens, { from: other });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: numCombinedTokens }, { from: sponsor })));
    await pricelessPositionManager.redeem({ rawValue: numTokens }, { from: sponsor });
    assert(await didContractThrow(pricelessPositionManager.redeem({ rawValue: numTokens }, { from: sponsor })));
  });
});