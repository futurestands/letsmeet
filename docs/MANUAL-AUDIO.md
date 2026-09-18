# Manual audio acceptance checklist

Technical mic publish / remote tile / `RoomAudioRenderer` paths are automated.

**Human-ear audio is MANUAL REQUIRED.** Do not mark production audio verified without a person listening.

## Setup

- Two real browsers (or two devices)
- Host account + participant account on staging
- Headphones recommended to avoid echo feedback

## HOST → PARTICIPANT

- [ ] Host speaks
- [ ] Participant hears host clearly
- [ ] Participant volume control works

## PARTICIPANT → HOST

- [ ] Participant speaks
- [ ] Host hears participant clearly

## Mute / unmute

- [ ] Host mutes self → participant stops hearing host
- [ ] Host unmutes → participant hears host again
- [ ] Participant mutes self → host stops hearing participant
- [ ] Host mute-other → participant mic disabled in room

## Devices / permissions

- [ ] Browser camera/mic permission prompt behaves correctly
- [ ] Device selection changes input without blank UI
- [ ] Output device selection (where supported) routes audio

## Reconnect

- [ ] Brief network interruption
- [ ] After reconnect, two-way audio still works without page reload

## Fail criteria

Any blank UI, false “connected” with silence, or auth bypass during reconnect → fail gate.
