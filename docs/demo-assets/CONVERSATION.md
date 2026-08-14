# Synthetic conversation demo

This folder contains a **fully synthetic, demo-safe conversation** for the interview walkthrough. It does not contain a real customer recording or real policy data. The manifest in [`conversation.json`](conversation.json) is the source of truth for ordering, speaker labels, transcript text, and audio paths.

| Sequence | Speaker | Conversation turn | Audio |
|---:|---|---|---|
| 1 | Sarah | Hi, you've reached Observe Insurance. I'm Sarah. What can I help you with today? | [sarah-01.wav](audio/sarah-01.wav) |
| 2 | Caller | I'd like to check my recent claim status. | [caller-02.wav](audio/caller-02.wav) |
| 3 | Sarah | I can help with that. Please share the phone number associated with your policy. | [sarah-03.wav](audio/sarah-03.wav) |
| 4 | Caller | My phone number is plus one, five five five, two three four, five six seven eight. | [caller-04.wav](audio/caller-04.wav) |
| 5 | Sarah | Thanks, Eleanor. To protect your privacy, could you please verify your date of birth? | [sarah-05.wav](audio/sarah-05.wav) |
| 6 | Caller | My date of birth is November twentieth, eighty-eight. | [caller-06.wav](audio/caller-06.wav) |
| 7 | Sarah | Your claim is currently under review. The next step is document verification. Please submit the signed repair estimate and photos of the windshield damage. | [sarah-07.wav](audio/sarah-07.wav) |
| 8 | Caller | What documents do I need to submit? | [caller-08.wav](audio/caller-08.wav) |

## How to use this in the interview

Open the home page and use the transcript table above as the scripted demonstration path. Play the clips in sequence to show that the UI can render a customer and agent turn as separate messages while the backend remains the authoritative owner of tool calls, audit events, outcomes, and termination. The shortened-year utterance in turn 6 is intentionally included to demonstrate normalization of `eighty-eight` to a four-digit birth year in the verification flow.

The audio is generated speech, not a provider call recording. In production, the same manifest shape can be populated from provider transcript events and retained according to the tenant's PII and retention policy.
