# drift

encrypted proximity exchange over bluetooth. MLS for nearby devices.

[![Status](https://img.shields.io/badge/status-proof%20of%20concept-orange?style=flat-square)](https://github.com/sleepycompile/drift)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-22+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![MLS](https://img.shields.io/badge/protocol-RFC%209420-4A90D9?style=flat-square)](https://datatracker.ietf.org/doc/html/rfc9420)

---

## what it is

Drift is a library for exchanging encrypted data between nearby devices over Bluetooth Low Energy. no internet. no server. no accounts. two devices walk past each other and trade sealed messages that only they can open.

it implements MLS (Messaging Layer Security, RFC 9420), the same protocol that powers [XMTP](https://xmtp.org). not inspired by it. the actual protocol. same ciphersuite, same key exchange, same authenticated encryption. the only difference is the wire: XMTP sends messages over the internet through gRPC. Drift sends them over Bluetooth between two devices that happen to be nearby.

built for [KidBlocksOS](https://github.com/sleepycompile/kidblocksos) as a StreetPass system for kids' tablets. but the protocol is general purpose. anything that needs encrypted local exchange between devices with wallets.

## how it works

every device runs as both a BLE peripheral (advertising) and a BLE central (scanning) at the same time. when two Drift devices detect each other:

```
Device A (advertising)          Device B (scanning)
    |                               |
    |<--- BLE discovery ----------->|
    |                               |
    |    both create MLS identities |
    |    (X25519 + Ed25519 keypairs)|
    |                               |
    |--- A creates MLS group ------>|  group of 2 (like XMTP DM)
    |--- A sends Welcome ---------->|  encrypted group secrets
    |                               |
    |<-- B joins group -------------|  decrypts secrets with private key
    |                               |
    |--- A encrypts card, sends --->|  MLS PrivateMessage
    |<-- B encrypts card, sends ----|  MLS PrivateMessage
    |                               |
    |    both decrypt and store     |
    |                               |
    |--- disconnect ----------------|  done. ~3 seconds.
```

the MLS session is ephemeral. create, exchange, destroy. no persistent group state. the encounter gets logged locally and the crypto material gets zeroed out.

## the crypto

this is not toy crypto or hand-rolled encryption. Drift uses [ts-mls](https://github.com/LukaJCB/ts-mls), a TypeScript implementation of RFC 9420 (Messaging Layer Security). the ciphersuite is the same one XMTP uses:

| component | algorithm | what it does |
|-----------|-----------|-------------|
| key exchange | DHKEM-X25519-HKDF-SHA256 | two strangers agree on a shared secret |
| encryption | ChaCha20-Poly1305 | seals the message so only the recipient can read it |
| key derivation | HKDF-SHA256 | turns the shared secret into usable encryption keys |
| signatures | Ed25519 | proves the sender is who they claim to be |
| protocol | MLS (RFC 9420) | ties it all together with forward secrecy and authentication |

the ciphersuite name, for those keeping score: `MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519`.

### why MLS and not just raw crypto

we could have done a bare X25519 key exchange and called it a day. but MLS gives us things that matter:

- **forward secrecy.** compromising a device later does not decrypt past encounters.
- **authentication.** the card is signed. you know it came from a real device, not a spoofed BLE advertiser.
- **protocol-level integrity.** MLS ties the key exchange, encryption, and signing into a single verified flow. no room for implementation mistakes where the handshake works but the signature check is skipped.
- **compatibility.** if a Drift device ever needs to bridge data to the XMTP network, the crypto is already compatible. same protocol, same ciphersuite, different transport.

### why not use XMTP directly

XMTP is built for internet messaging. its transport layer is gRPC to centralized nodes. you need connectivity. for a kid at a park with no WiFi, that is a non-starter. Drift takes the crypto layer that XMTP chose (because they chose well) and runs it over a transport that works with zero infrastructure.

## what gets exchanged

in KidBlocksOS, the payload is a profile card:

```json
{
  "v": 1,
  "name": "CosmicFox",
  "buddy": 3,
  "motto": "catch me if you can",
  "stats": {
    "encounters": 42,
    "appsBought": 7,
    "appsSold": 2,
    "coinsEarned": 1.50
  },
  "apps": [
    { "id": "cookie-catcher", "name": "Cookie Catcher" },
    { "id": "space-dino", "name": "Space Dinosaur" }
  ]
}
```

but Drift does not care what the payload is. it encrypts and delivers bytes. the application decides what those bytes mean.

## running the tests

```bash
cd drift
npm install
npm test
```

the test creates two MLS identities, runs the full DM handshake (group creation, Welcome, join), encrypts profile cards in both directions, and decrypts them. all on one machine, no BLE hardware needed.

```
=== Drift MLS DM Test ===

Protocol: MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519

--- Step 1: Create MLS identities ---
  ok  Alice identity created (20ms)
  ok  Bob identity created (4ms)

--- Step 2: Alice initiates MLS DM ---
  ok  Alice is initiator (37ms)
  ok  Welcome message generated

--- Step 3: Bob joins using Welcome ---
  ok  Bob joined as responder (14ms)

--- Step 4-7: Encrypted card exchange ---
  ok  Alice -> Bob: CosmicFox (encounters: 42)
  ok  Bob -> Alice: PixelWolf (coins: 3.25)

16/16 passed
Total: 97ms
```

## requirements

- Node.js 22+
- for BLE: Linux with BlueZ 5.x (Raspberry Pi works out of the box)
- for tests only: no hardware needed, pure crypto

## dependencies

| package | what | why |
|---------|------|-----|
| ts-mls | MLS protocol (RFC 9420) | the actual encryption protocol |
| @hpke/chacha20poly1305 | ChaCha20-Poly1305 AEAD | required by the XMTP ciphersuite |
| @abandonware/noble | BLE central (scanning) | discovers nearby devices |
| @abandonware/bleno | BLE peripheral (advertising) | makes this device discoverable |
| better-sqlite3 | encounter database | logs who you passed and when |
| msgpack-lite | compact serialization | fits profile cards into BLE payloads |

## project structure

```
drift/
  src/
    mls-session.mjs      MLS DM sessions (create, join, encrypt, decrypt)
  test/
    mls-dm.test.mjs       full handshake + encrypted exchange test
  package.json
  README.md
  LICENSE
```

BLE transport and encounter storage are in progress. the MLS crypto layer is complete and tested.

## status

proof of concept.

- [x] MLS identity creation (Ed25519 keypairs)
- [x] MLS DM session (group of 2, Welcome, join)
- [x] encrypted message exchange (ChaCha20-Poly1305)
- [x] forward secrecy (key material zeroed after use)
- [x] bidirectional card exchange (both sides send and receive)
- [x] msgpack serialization for compact payloads
- [ ] BLE advertising and scanning (noble/bleno integration)
- [ ] GATT service for key exchange and card transfer
- [ ] encounter database (SQLite, dedup, cooldown)
- [ ] systemd service for background operation
- [ ] KidBlocksOS UI integration (notification, encounter log, plaza)

## credits

the protocol design follows XMTP's lead. they picked the right ciphersuite and the right standard (MLS, RFC 9420) for encrypted messaging between wallet-identified devices. Drift adapts that work for local transport.

[ts-mls](https://github.com/LukaJCB/ts-mls) by Luka Jacobowitz provides the MLS implementation.

## license

[MIT](LICENSE)

---

part of [KidBlocksOS](https://github.com/sleepycompile/kidblocksos)
