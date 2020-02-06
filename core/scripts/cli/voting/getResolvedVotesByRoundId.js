const style = require("../textStyle");

// Given a list of revealed votes for a user, return
// the filtered list of votes that have successfully resolved a price
// mapped to their round ID's.
//
// Cross reference revealed votes with a list of already-retrieved
// rewards by the user to remove duplicate retrievals
module.exports = async (web3, votingContract, account) => {
  // All rewards available must be tied to formerly revealed votes
  const revealedVotes = await votingContract.getPastEvents("VoteRevealed", {
    filter: { voter: account },
    fromBlock: 0
  });

  const resolvedVotesByRoundId = {};

  for (let i = 0; i < revealedVotes.length; i++) {
    const identifier = revealedVotes[i].args.identifier.toString();
    const time = revealedVotes[i].args.time.toString();
    const roundId = revealedVotes[i].args.roundId.toString();

    try {
      const price = (await votingContract.getPrice(identifier, time)).toString();

      // If retrieveRewards returns 0, then the rewards have already been retrieved
      let potentialRewards = await votingContract.retrieveRewards.call(account, roundId, [{ identifier, time }], {
        from: account
      });
      potentialRewards = potentialRewards.toString();

      if (potentialRewards !== "0") {
        const resolvedVote = {
          price,
          name: `${web3.utils.hexToUtf8(identifier)} @ ${style.formatSecondsToUtc(time)}`,
          identifier,
          time,
          roundId,
          potentialRewards
        };

        // If this is a new roundId, begin a new array of resolved votes for the roundId
        if (!resolvedVotesByRoundId[roundId]) {
          resolvedVotesByRoundId[roundId] = [resolvedVote];
        } else {
          resolvedVotesByRoundId[roundId].push(resolvedVote);
        }
      } else {
        // Account already retrieved this reward
        continue;
      }
    } catch (err) {
      // getPrice will throw if the vote has not resolved
      continue;
    }
  }

  // Create a mapping of round IDs to total rewards per round
  let roundIds = [];
  Object.keys(resolvedVotesByRoundId).forEach(id => {
    let totalRewardsInRound = 0;
    resolvedVotesByRoundId[id].forEach(reward => {
      totalRewardsInRound += parseInt(reward.potentialRewards);
    });
    roundIds.push({
      name: `ID: ${id}, rewards: ${totalRewardsInRound / 10e18}`,
      value: id,
      totalRewardsInRound
    });
  });
  roundIds = roundIds.sort((a, b) => {
    return parseInt(a.id) - parseInt(a.id);
  });

  return { resolvedVotesByRoundId, roundIds };
};
