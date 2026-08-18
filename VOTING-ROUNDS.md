# Burger Money voting rounds

Round advancement is controlled on Base by the project developer wallet, `0x9CD7C9196A4C1836A3DF089cb210272e07e6A5e5`. Holders cannot create, replace, or skip rounds.

## Start the next round

1. Open `/vote.html` in a browser with the developer wallet available.
2. Select **Connect wallet** and approve the Base network switch if needed.
3. Use the developer-only panel and select **Start round N →**.
4. Confirm the token approval transaction. No $BURGERS is transferred.
5. After Base confirms the transaction, the page opens the next numbered round with five empty write-in seats.

The approval grants only a microscopic encoded allowance to the dedicated, unreachable round-control address. Its value stores the next round number and a Base block anchor. The page verifies the `Approval` event came from the configured developer wallet, uses the confirmed event as the new round boundary, and ignores any nomination or vote that predates it.

`vote-config.json` remains the immutable seed and safety configuration for the ballot. The client rejects changes to the canonical token, developer wallet, round-control address, encoding base, or nomination and voting inboxes.

Never reuse a prior round number. Nomination and vote transfers encode a choice as `round * 1000 + organizationId` token wei, so every signal remains attributable to its original round.

## Directory updates

`vote-organizations.json` contains the organizations returned by The Giving Block's Hunger impact-area filter. Preserve existing numeric IDs when refreshing the list; append new IDs for new organizations and do not reassign IDs that have already been used onchain.

The ballot is advisory. Burger Money retains final discretion and should independently verify a recipient and its donation instructions before sending funds.
