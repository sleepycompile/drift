/**
 * mls-session.mjs — XMTP-compatible MLS DM sessions over any transport
 * 
 * Uses ts-mls (RFC 9420) with the same ciphersuite XMTP uses:
 * MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519
 * 
 * This is the actual MLS protocol — not "inspired by" XMTP,
 * but running the same cryptographic standard they built on.
 * 
 * Adapted for KidBlocks StreetPass: DM-only (groups of 2),
 * ephemeral sessions, BLE transport instead of gRPC.
 */

import {
  createApplicationMessage,
  createCommit,
  createGroup,
  joinGroup,
  processMessage,
  getCiphersuiteImpl,
  getCiphersuiteFromName,
  defaultLifetime,
  defaultProposalTypes,
  generateKeyPackage,
  defaultAuthenticationService,
  acceptAll,
  zeroOutUint8Array,
} from 'ts-mls';

// Same ciphersuite XMTP uses
const CIPHERSUITE_NAME = 'MLS_128_DHKEMX25519_CHACHA20POLY1305_SHA256_Ed25519';

let _cachedImpl = null;
async function getImpl() {
  if (!_cachedImpl) {
    const cs = getCiphersuiteFromName(CIPHERSUITE_NAME);
    _cachedImpl = await getCiphersuiteImpl(cs);
  }
  return _cachedImpl;
}

export class MlsIdentity {
  constructor(name, publicPackage, privatePackage, cipherSuite) {
    this.name = name;
    this.publicPackage = publicPackage;
    this.privatePackage = privatePackage;
    this.cipherSuite = cipherSuite;
  }
}

/**
 * Create a new MLS identity for a device.
 * Equivalent to XMTP's Client.create()
 */
export async function createIdentity(deviceName) {
  const impl = await getImpl();
  
  const credential = {
    credentialType: 'basic',
    identity: new Uint8Array(new TextEncoder().encode(deviceName)),
  };

  const capabilities = {
    versions: ['mls10'],
    ciphersuites: [CIPHERSUITE_NAME],
    extensions: [],
    proposals: [],
    credentials: ['basic'],
  };

  // v1.x positional API: (credential, capabilities, lifetime, extensions, cs)
  const kp = await generateKeyPackage(credential, capabilities, defaultLifetime, [], impl);
  return new MlsIdentity(deviceName, kp.publicPackage, kp.privatePackage, impl);
}

export class MlsDmSession {
  constructor(state, impl, role) {
    this.state = state;
    this.impl = impl;
    this.role = role;
  }

  async encrypt(plaintext) {
    const data = typeof plaintext === 'string'
      ? new TextEncoder().encode(plaintext)
      : plaintext;

    // v1.x: createApplicationMessage(state, message, cs) → { newState, privateMessage, consumed }
    const result = await createApplicationMessage(this.state, data, this.impl);
    this.state = result.newState;
    result.consumed.forEach(zeroOutUint8Array);
    // Wrap as MLS message with wireformat for processMessage
    return { wireformat: 'mls_private_message', privateMessage: result.privateMessage };
  }

  async decrypt(mlsMessage) {
    // v1.x: processMessage(message, state, pskIndex, action, cs)
    const result = await processMessage(mlsMessage, this.state, undefined, acceptAll, this.impl);
    this.state = result.newState;

    if (result.kind === 'newState') return null;
    result.consumed.forEach(zeroOutUint8Array);
    return result.message;
  }
}

/**
 * Initiate an MLS DM. Creates a group of 2 + Welcome.
 * Equivalent to XMTP's newDm()
 */
export async function initiateDm(myIdentity, theirPublicPackage) {
  const impl = myIdentity.cipherSuite;

  const groupId = new Uint8Array(16);
  crypto.getRandomValues(groupId);

  // v1.x: createGroup(groupId, keyPackage, privateKeyPackage, extensions, cs)
  let groupState = await createGroup(groupId, myIdentity.publicPackage, myIdentity.privatePackage, [], impl);

  // Add responder: createCommit(context, options)
  // context = { state, cipherSuite }
  // options = { extraProposals }
  const addProposal = {
    proposalType: 'add',  // string, not enum number
    add: { keyPackage: theirPublicPackage },
  };

  const commitResult = await createCommit(
    { state: groupState, cipherSuite: impl },
    { extraProposals: [addProposal] },
  );

  groupState = commitResult.newState;
  commitResult.consumed.forEach(zeroOutUint8Array);

  const welcome = commitResult.welcome;  // Welcome is directly on commitResult
  const ratchetTree = groupState.ratchetTree;
  const session = new MlsDmSession(groupState, impl, 'initiator');

  return { session, welcome, ratchetTree };
}

/**
 * Join an MLS DM using the Welcome message.
 * Equivalent to processing an XMTP DM invitation.
 */
export async function respondToDm(myIdentity, welcome, ratchetTree) {
  const impl = myIdentity.cipherSuite;

  // v1.x: joinGroup(welcome, keyPackage, privateKeys, pskSearch, cs, ratchetTree)
  const groupState = await joinGroup(
    welcome,
    myIdentity.publicPackage,
    myIdentity.privatePackage,
    undefined,  // pskSearch
    impl,
    ratchetTree,
  );

  return new MlsDmSession(groupState, impl, 'responder');
}

export function getCiphersuiteInfo() {
  return {
    name: CIPHERSUITE_NAME,
    kem: 'DHKEM-X25519-HKDF-SHA256',
    aead: 'ChaCha20-Poly1305',
    hash: 'SHA-256',
    signature: 'Ed25519',
    origin: 'Same ciphersuite used by XMTP (RFC 9420 MLS)',
  };
}
