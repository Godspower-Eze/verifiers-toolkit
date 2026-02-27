const { buildPoseidon, buildBabyjub } = require('circomlibjs');
const crypto = require('crypto');

// Baby JubJub subgroup order
const l = BigInt('2736030358979909402780800718157159386076813972158567259200215660948447373041');

function fmt(n) {
    return String(n).replace(/,/g, '');
}

async function main() {
    const poseidon = await buildPoseidon();
    const babyjub = await buildBabyjub();
    const F = babyjub.F;

    // Generate a random secret scalar < l (matches circuit's secret input requirement)
    let secretScalar;
    do {
        secretScalar = BigInt('0x' + crypto.randomBytes(32).toString('hex'));
    } while (secretScalar >= l);

    // Derive Baby JubJub public key — matches BabyPbk()(secret) in the circuit
    const pubKey = babyjub.mulPointEscalar(babyjub.Base8, secretScalar);
    const Ax = F.toObject(pubKey[0]);
    const Ay = F.toObject(pubKey[1]);

    // Compute identity commitment — matches Poseidon(2)([Ax, Ay]) in the circuit
    const commitment = babyjub.F.toObject(poseidon([Ax, Ay]));

    const treeDepth = 10;
    const numLeaves = Math.pow(2, treeDepth);

    const leaves = Array(numLeaves).fill(BigInt(0));
    leaves[0] = commitment;

    const levels = [leaves];
    let currentLevel = [...leaves];

    for (let level = 0; level < treeDepth; level++) {
        const nextLevel = [];
        for (let i = 0; i < currentLevel.length; i += 2) {
            const left = currentLevel[i];
            const right = (i + 1 < currentLevel.length) ? currentLevel[i + 1] : BigInt(0);
            nextLevel.push(babyjub.F.toObject(poseidon([left, right])));
        }
        levels.push(nextLevel);
        currentLevel = nextLevel;
    }

    const merkleSiblings = [];
    let index = 0;

    for (let level = 0; level < treeDepth; level++) {
        const siblingIndex = index ^ 1;
        if (siblingIndex < levels[level].length) {
            merkleSiblings.push(fmt(levels[level][siblingIndex]));
        } else {
            merkleSiblings.push('0');
        }
        index = Math.floor(index / 2);
    }

    const scope = BigInt(1);
    const message = BigInt(42);

    const inputJson = {
        secret: fmt(secretScalar),
        merkleProofLength: treeDepth,
        merkleProofIndex: 0,
        merkleProofSiblings: merkleSiblings,
        message: fmt(message),
        scope: fmt(scope)
    };

    console.log(JSON.stringify(inputJson));
}

main().catch(console.error);
