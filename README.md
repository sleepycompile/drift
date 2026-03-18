# drift

encrypted proximity exchange over bluetooth.

[![Status](https://img.shields.io/badge/status-working-brightgreen?style=flat-square)](https://github.com/sleepycompile/drift)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

---

## what it is

Drift is a library for exchanging encrypted data between nearby devices over Bluetooth Low Energy. no internet. no server. no accounts. two devices walk past each other and trade sealed messages that only they can open.

the cryptographic primitives are the same ones [XMTP](https://xmtp.org) uses in their MLS ciphersuite: X25519 for the key exchange, ChaCha20-Poly1305 for authenticated encryption, Ed25519 for signatures. we use them directly over BLE rather than through the full MLS protocol, because an ephemeral two-device exchange does not need group state management.

built for [KidBlocksOS](https://github.com/sleepycompile/kidblocksos) as a StreetPass system for kids' tablets. but the protocol is general purpose. anything that needs encrypted local exchange between devices.

## how it works

each device runs a BLE peripheral (advertising a GATT service) and a BLE central (scanning for other devices) simultaneously. when two Drift devices detect each other:

```
Device A (scanner)              Device B (advertiser)
    |                               |
    |--- BLE discovery ------------>|
    |                               |
    |--- read B's X25519 pubkey --->|
    |<-- B's ephemeral public key --|
    |                               |
    |--- write A's X25519 pubkey -->|
    |    both derive shared secret  |
    |    (X25519 ECDH)              |
    |                               |
    |--- read B's encrypted card -->|
    |    (ChaCha20-Poly1305)        |
    |                               |
    |--- write A's encrypted card ->|
    |    (ChaCha20-Poly1305)        |
    |                               |
    |--- disconnect ----------------|  done. ~2 seconds.
```

the shared secret is ephemeral. derived from single-use X25519 keypairs generated fresh each boot. after the exchange, the key material is discarded. the encounter gets logged locally with the decrypted profile card.

## the crypto

| component | algorithm | what it does |
|-----------|-----------|-------------|
| key exchange | X25519 (ECDH) | two strangers agree on a shared secret |
| encryption | ChaCha20-Poly1305 | authenticated encryption, seals the card |
| key derivation | ECDH shared secret | direct use of the X25519 output |
| transport | BLE GATT | two characteristics, read/write |

the ciphersuite primitives match XMTP's `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`. we chose them because the XMTP team did the hard work of evaluating which algorithms belong together. we just run them over a different wire.

### why not full MLS

MLS (RFC 9420) is designed for persistent groups with evolving membership. Drift exchanges are ephemeral: two devices, one encounter, done. the full MLS handshake (KeyPackage, Welcome, group state) adds ~800 bytes of overhead that does not fit in a single BLE GATT read (512 byte MTU limit). the raw X25519 exchange fits in 44 bytes.

MLS gives you forward secrecy through ratcheting. we get forward secrecy through ephemerality: the keypairs are regenerated every boot and the shared secret is never stored.

the MLS proof of concept is still in the repo (`src/mls-session.mjs`, 16/16 tests passing) for anyone who wants the full protocol on a transport with larger payloads.

### why not use XMTP directly

XMTP's transport is gRPC to centralized nodes. it requires internet. for a kid at a park with no WiFi, that is a non-starter. Drift takes the crypto primitives that XMTP chose (because they chose well) and runs them over a transport that works with zero infrastructure.

## what gets exchanged

in KidBlocksOS, the payload is a profile card:

```json
{
  "v": 2,
  "name": "CosmicFox",
  "buddy": "dinosaur",
  "age": 7,
  "stats": {
    "encounters": 42,
    "appsBought": 7,
    "appsSold": 2,
    "appsListed": 3,
    "appsOwned": 5,
    "projectsBuilt": 12,
    "totalVolume": 1.50
  },
  "apps": [
    { "id": "cookie-catcher", "name": "Cookie Catcher", "studio": "games" },
    { "id": "space-dino", "name": "Space Dinosaur", "studio": "games", "mine": true }
  ]
}
```

stats are pulled live from the device: encounter count from the drift log, apps bought/sold/listed from the marketplace data, projects built from the project directory, volume from the activity log. the card refreshes every 5 minutes.

but Drift does not care what the payload is. it encrypts and delivers bytes. the application decides what those bytes mean.

## BLE protocol

two GATT characteristics under service UUID `ff01`:

| char | UUID | properties | purpose |
|------|------|------------|---------|
| key | `ff02` | read, write | ephemeral X25519 public key + display name |
| card | `ff03` | read, write | nonce + ChaCha20-Poly1305 encrypted card |

the key characteristic payload is msgpack-encoded: `{ k: <32-byte pubkey>, n: <name string> }`. ~44 bytes.

the card characteristic payload is msgpack-encoded: `{ n: <12-byte nonce>, c: <ciphertext> }`. typically under 200 bytes.

both fit comfortably in a single BLE GATT read/write (512 byte MTU).

### exchange protocol

1. scanner reads `ff02` from advertiser (gets advertiser's X25519 pubkey)
2. scanner writes own X25519 pubkey to `ff02`
3. both sides derive shared secret via X25519 ECDH
4. advertiser encrypts its card with ChaCha20-Poly1305 using the shared secret
5. scanner reads `ff03` (gets advertiser's encrypted card, decrypts it)
6. scanner encrypts its own card and writes to `ff03`
7. advertiser decrypts the received card
8. disconnect

total: 2 reads, 2 writes. under 500 bytes transferred. ~2 seconds.

## running the tests

```bash
cd drift
npm install
npm test
```

the test creates two MLS identities, runs the full DM handshake (group creation, Welcome, join), encrypts profile cards in both directions, and decrypts them. all on one machine, no BLE hardware needed.

```
16/16 passed
Total: 97ms
```

## requirements

- Node.js 22+
- for BLE: Linux with BlueZ 5.x (Raspberry Pi works out of the box)
- for dual-role (advertise + scan simultaneously): BlueZ 5.72+ with experimental flag
- for tests only: no hardware needed, pure crypto

## project structure

```
drift/
  src/
    mls-session.mjs       MLS DM sessions (full RFC 9420 proof of concept)
  test/
    mls-dm.test.mjs       MLS handshake + encrypted exchange test
  package.json
  README.md
  LICENSE
```

the BLE transport and encounter storage run as part of KidBlocksOS. the MLS crypto layer is the standalone library.

## status

working on two Raspberry Pi 5 devices over BLE 5.0.

- [x] X25519 + ChaCha20-Poly1305 encrypted card exchange
- [x] BLE GATT service (advertising + scanning)
- [x] dual-role operation (advertise and scan simultaneously via BlueZ D-Bus)
- [x] encounter logging with 8-hour per-device cooldown
- [x] live device stats in profile cards (encounters, apps, volume)
- [x] msgpack serialization (compact BLE payloads)
- [x] systemd service for background operation
- [x] KidBlocksOS UI integration (encounter plaza, home screen tile)
- [x] MLS proof of concept (16/16 tests, RFC 9420 ciphersuite)
- [ ] Ed25519 wallet signatures on cards
- [ ] SQLite encounter database (currently JSON file)
- [ ] OTA card schema upgrades

## credits

the cryptographic design follows XMTP's lead. they picked the right primitives for encrypted messaging between wallet-identified devices. Drift uses those primitives for local transport.

[ts-mls](https://github.com/LukaJCB/ts-mls) by Luka Jacobowitz provides the MLS implementation used in the proof of concept.

[@noble/curves](https://github.com/paulmillr/noble-curves) and [@noble/ciphers](https://github.com/paulmillr/noble-ciphers) by Paul Miller provide the X25519 and ChaCha20-Poly1305 implementations.

## license

[MIT](LICENSE)

---

part of [KidBlocksOS](https://github.com/sleepycompile/kidblocksos)
