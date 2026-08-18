# Burger Money voting rounds

The public ballot is controlled by `vote-config.json`. Only a repository release can open, close, or replace a round; holders cannot create or extend one.

Keep `controller` set to the project developer wallet, `0x9CD7C9196A4C1836A3DF089cb210272e07e6A5e5`. The client rejects a configuration that changes the canonical token, developer wallet, or protocol inboxes.

## Open a new round

1. Increase `round` by one.
2. Keep `slots` at `5` so the round opens with five empty community seats.
3. Set `status` to `open`, update `title` and `openedAt`, and set `startBlock` to the current Base block immediately before release.
4. Remove any prior `endBlock` value.
5. Publish the site and verify `/vote.html` shows the new round with five open seats.

Never reuse a prior round number. Nomination and vote transfers encode a choice as `round * 1000 + organizationId` token wei, so the round number is part of the permanent public record.

## Close a round

1. Set `status` to `closed`.
2. Add `endBlock` using the Base block at the intended close time.
3. Publish. The page will preserve the final result and disable nominations and voting.

## Directory updates

`vote-organizations.json` contains the organizations returned by The Giving Block's Hunger impact-area filter. Preserve existing numeric IDs when refreshing the list; append new IDs for new organizations and do not reassign IDs that have already been used onchain.

The ballot is advisory. Burger Money retains final discretion and should independently verify a recipient and its donation instructions before sending funds.
