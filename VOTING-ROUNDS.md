# Burger Money community ballots

Voting-round advancement is controlled on Base by the project developer wallet, `0x9CD7C9196A4C1836A3DF089cb210272e07e6A5e5`. Holders cannot create, replace, or skip voting rounds.

## Start a fresh voting round

1. Open `/vote` in a browser with the developer wallet available.
2. Select **Connect wallet** and approve the Base network switch if needed.
3. Use the developer-only panel and select **Start fresh voting round →**.
4. Confirm the token approval transaction. No $BURGERS is transferred.
5. After Base confirms the transaction, the page opens a fresh voting round with five empty write-in ballots.

The approval grants only a microscopic encoded allowance to the dedicated, unreachable ballot-control address. Its value stores an internal ballot identifier and a Base block anchor. The page verifies the `Approval` event came from the configured developer wallet, uses the confirmed event as the new ballot boundary, and ignores any nomination or vote that predates it. The identifier is deliberately not shown in the public interface.

`vote-config.json` remains the immutable seed and safety configuration for the ballot. The client rejects changes to the canonical token, developer wallet, round-control address, encoding base, or nomination and voting inboxes.

Never reuse a prior internal ballot identifier. Nomination and vote transfers encode a choice as `internalBallotId * 1000 + organizationId` token wei, so every signal remains attributable to its original ballot.

## Directory updates

`vote-organizations.json` contains the organizations returned by The Giving Block's Hunger impact-area filter. Preserve existing numeric IDs when refreshing the list; append new IDs for new organizations and do not reassign IDs that have already been used onchain.

The ballot is advisory. Burger Money retains final discretion and should independently verify a recipient and its donation instructions before sending funds.
