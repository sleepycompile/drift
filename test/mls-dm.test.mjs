/**
 * Test: MLS DM session between two KidBlocks devices
 * 
 * Proves that XMTP's MLS protocol (RFC 9420) works for
 * encrypted 1:1 StreetPass card exchange — no internet needed.
 */

import {
  createIdentity,
  initiateDm,
  respondToDm,
  getCiphersuiteInfo,
} from '../src/mls-session.mjs';

import msgpack from 'msgpack-lite';

const aliceCard = {
  v: 1,
  name: 'CosmicFox',
  buddy: 3,
  motto: 'catch me if you can',
  stats: { encounters: 42, appsBought: 7, appsSold: 2, coinsEarned: 1.50 },
  apps: [
    { id: 'cookie-catcher', name: 'Cookie Catcher' },
    { id: 'space-dino', name: 'Space Dinosaur' },
  ],
};

const bobCard = {
  v: 1,
  name: 'PixelWolf',
  buddy: 7,
  motto: 'building the future',
  stats: { encounters: 18, appsBought: 3, appsSold: 5, coinsEarned: 3.25 },
  apps: [
    { id: 'bubble-pop', name: 'Bubble Pop' },
    { id: 'music-maker', name: 'Music Maker' },
    { id: 'rainbow-painter', name: 'Rainbow Painter' },
  ],
};

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function testMlsDm() {
  console.log('\n=== KidBlocks StreetPass — MLS DM Test ===\n');
  
  const info = getCiphersuiteInfo();
  console.log(`Protocol: ${info.name}`);
  console.log(`KEM: ${info.kem} | AEAD: ${info.aead} | Sig: ${info.signature}`);
  console.log(`Origin: ${info.origin}\n`);

  // Step 1: Create MLS identities (like XMTP Client.create())
  console.log('--- Step 1: Create MLS identities ---');
  const t0 = Date.now();
  
  const alice = await createIdentity('CosmicFox');
  assert(alice.publicPackage !== null, `Alice identity created (${Date.now() - t0}ms)`);
  
  const t1 = Date.now();
  const bob = await createIdentity('PixelWolf');
  assert(bob.publicPackage !== null, `Bob identity created (${Date.now() - t1}ms)`);

  // Step 2: Alice initiates DM (she scanned Bob first)
  // Creates MLS group of 2 + Welcome message — same as XMTP newDm()
  console.log('\n--- Step 2: Alice initiates MLS DM ---');
  const t2 = Date.now();
  
  const { session: aliceSession, welcome, ratchetTree } = await initiateDm(alice, bob.publicPackage);
  const initTime = Date.now() - t2;
  
  assert(aliceSession.role === 'initiator', `Alice is initiator (${initTime}ms)`);
  assert(welcome !== undefined, 'Welcome message generated (encrypted group secrets for Bob)');

  // Step 3: Bob joins using Welcome (like processing XMTP DM invite)
  console.log('\n--- Step 3: Bob joins using Welcome ---');
  const t3 = Date.now();
  
  const bobSession = await respondToDm(bob, welcome, ratchetTree);
  const joinTime = Date.now() - t3;
  
  assert(bobSession.role === 'responder', `Bob joined as responder (${joinTime}ms)`);

  // Step 4: Alice sends encrypted profile card
  console.log('\n--- Step 4: Alice sends encrypted profile card ---');
  const aliceCardBytes = Buffer.from(msgpack.encode(aliceCard));
  console.log(`  Raw card: ${aliceCardBytes.length} bytes (msgpack)`);
  
  const t4 = Date.now();
  const encAlice = await aliceSession.encrypt(aliceCardBytes);
  const encTime1 = Date.now() - t4;
  assert(encAlice !== null, `Encrypted with MLS PrivateMessage (${encTime1}ms)`);

  // Step 5: Bob decrypts Alice's card
  console.log('\n--- Step 5: Bob decrypts Alice\'s card ---');
  const t5 = Date.now();
  
  const decAlice = await bobSession.decrypt(encAlice);
  const decTime1 = Date.now() - t5;
  
  const aliceDecoded = msgpack.decode(Buffer.from(decAlice));
  assert(aliceDecoded.name === 'CosmicFox', `Name: ${aliceDecoded.name} (${decTime1}ms)`);
  assert(aliceDecoded.buddy === 3, `Buddy: ${aliceDecoded.buddy}`);
  assert(aliceDecoded.stats.encounters === 42, `Encounters: ${aliceDecoded.stats.encounters}`);
  assert(aliceDecoded.apps.length === 2, `Apps: ${aliceDecoded.apps.map(a => a.name).join(', ')}`);

  // Step 6: Bob sends his encrypted profile card
  console.log('\n--- Step 6: Bob sends encrypted profile card ---');
  const bobCardBytes = Buffer.from(msgpack.encode(bobCard));
  
  const t6 = Date.now();
  const encBob = await bobSession.encrypt(bobCardBytes);
  const encTime2 = Date.now() - t6;
  assert(encBob !== null, `Encrypted (${encTime2}ms)`);

  // Step 7: Alice decrypts Bob's card
  console.log('\n--- Step 7: Alice decrypts Bob\'s card ---');
  const t7 = Date.now();
  
  const decBob = await aliceSession.decrypt(encBob);
  const decTime2 = Date.now() - t7;
  
  const bobDecoded = msgpack.decode(Buffer.from(decBob));
  assert(bobDecoded.name === 'PixelWolf', `Name: ${bobDecoded.name} (${decTime2}ms)`);
  assert(bobDecoded.buddy === 7, `Buddy: ${bobDecoded.buddy}`);
  assert(bobDecoded.stats.coinsEarned === 3.25, `Coins: ${bobDecoded.stats.coinsEarned}`);
  assert(bobDecoded.apps.length === 3, `Apps: ${bobDecoded.apps.map(a => a.name).join(', ')}`);
  assert(bobDecoded.motto === 'building the future', `Motto: "${bobDecoded.motto}"`);

  // Summary
  const totalTime = Date.now() - t0;
  console.log('\n=== Results ===');
  console.log(`${passed}/${passed + failed} passed, ${failed} failed`);
  console.log(`Total: ${totalTime}ms`);
  console.log(`  Identities: ~${Date.now() - t0 - initTime - joinTime - encTime1 - decTime1 - encTime2 - decTime2}ms`);
  console.log(`  DM init (group + welcome): ${initTime}ms`);
  console.log(`  DM join (process welcome): ${joinTime}ms`);
  console.log(`  Encrypt/decrypt (2 cards): ${encTime1 + decTime1 + encTime2 + decTime2}ms`);
  
  if (failed > 0) process.exit(1);
  console.log('\n✅ XMTP MLS protocol working for StreetPass DM exchange!');
}

testMlsDm().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
