/**
 * This code is from the garaga library (https://github.com/keep-starknet-strange/garaga).
 * It was copied here because garaga does not expose certain functions needed by this project.
 * A PR has been submitted to address this: https://github.com/keep-starknet-strange/garaga/pull/492
 */

import * as garaga from 'garaga';

const CurveId = {
    BN254: 0,
    BLS12_381: 1,
    SECP256K1: 2,
    SECP256R1: 3,
    ED25519: 4,
} as const;

type CurveId = (typeof CurveId)[keyof typeof CurveId];

export interface G1Point {
    x: bigint;
    y: bigint;
    curveId: CurveId
}

export interface G2Point {
    x: [bigint, bigint];
    y: [bigint, bigint];
    curveId: CurveId
}

export interface G1G2Pair {
    p: G1Point;
    q: G2Point;
    curveId: CurveId
}

export interface Groth16Proof {
    a: G1Point,
    b: G2Point,
    c: G1Point,
    publicInputs: bigint[],
    curveId?: CurveId,
    imageIdJournalRisc0?: { imageId: Uint8Array, journal: Uint8Array },
    vkeyPublicValuesSp1?: { vkey: Uint8Array, publicValues: Uint8Array }
}

export interface Groth16VerifyingKey {
    alpha: G1Point,
    beta: G2Point,
    gamma: G2Point,
    delta: G2Point,
    ic: G1Point[]
}

interface WeiertrassCurve {
    cairoZeroNamespaceName: string,
    curveId: CurveId,
    p: bigint,
    n: bigint,
    h: bigint,
    a?: bigint,
    b?: bigint,
    fpGenerator: bigint,
    Gx: bigint,
    Gy: bigint,
}

interface PairingCurve extends WeiertrassCurve {
    x: bigint,
    irreduciblePolys: Record<number, number[]>,
    nrA0: bigint,
    nrA1: bigint,
    b20: bigint,
    b21: bigint,
    loopCounter: number[],
    lineFunctionSparcity: number[],
    finalExpCofactor: bigint,
    G2x: [bigint, bigint],
    G2y: [bigint, bigint],
}

interface TwistedEdwardsCurve extends WeiertrassCurve {
    aTwisted: bigint,
    dTwisted: bigint
}

export const jy00 = (value: bigint): number[] => {
    /**
     * This is a minimum-Hamming-Weight left-to-right recoding.
     * It outputs signed {-1, 0, 1} bits from MSB to LSB
     * with minimal Hamming Weight to minimize operations
     * in Miller Loops and vartime scalar multiplications
     *
     * - Optimal Left-to-Right Binary Signed-Digit Recoding
     *   Joye, Yen, 2000
     *   https://marcjoye.github.io/papers/JY00sd2r.pdf
     */

    const bit = (value: bigint, index: number): bigint => {
        return (value >> BigInt(index)) & 1n;
    };

    let bi = 0n, bi1 = 0n, ri = 0n, ri1 = 0n, ri2 = 0n;
    const bits = value.toString(2).length;
    const recoded: number[] = [];

    for (let i = bits; i >= 0; i--) {
        if (i === bits) {
            ri1 = bit(value, bits - 1);
            ri2 = bit(value, bits - 2);
        } else {
            bi = bi1;
            ri = ri1;
            ri1 = ri2;
            ri2 = i >= 2 ? bit(value, i - 2) : 0n;
        }

        bi1 = (bi + ri1 + ri2) >> 1n;
        recoded.push(Number(-2n * bi + ri + bi1)); // Cast bigint result to number
    }

    return recoded;
}


export const CURVES:  Record<CurveId, WeiertrassCurve | PairingCurve | TwistedEdwardsCurve> = {
    [CurveId.BN254]: {
        cairoZeroNamespaceName: "bn254",
        curveId: CurveId.BN254,
        p: BigInt("0x30644E72E131A029B85045B68181585D97816A916871CA8D3C208C16D87CFD47"),
        n: BigInt("0x44E992B44A6909F1"),
        h: BigInt(1),
        irreduciblePolys: {
            6: [82, 0, 0, -18, 0, 0, 1],
            12: [82, 0, 0, 0, 0, 0, -18, 0, 0, 0, 0, 0, 1],
        },
        nrA0: BigInt(9),
        nrA1: BigInt(1),
        a: BigInt(0),
        b: BigInt(3),
        b20: BigInt("0x2B149D40CEB8AAAE81BE18991BE06AC3B5B4C5E559DBEFA33267E6DC24A138E5"),
        b21: BigInt("0x9713B03AF0FED4CD2CAFADEED8FDF4A74FA084E52D1852E4A2BD0685C315D2"),
        loopCounter: jy00(BigInt(6) * BigInt("0x44E992B44A6909F1")  + BigInt(2)).reverse(),
        lineFunctionSparcity: [2, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0 ,0],
        finalExpCofactor: BigInt("1469306990098747947464455738335385361638823152381947992820"),
        fpGenerator: BigInt(3),
        Gx: BigInt("0x1"),
        Gy: BigInt("0x2"),
        G2x: [BigInt("0x1800DEEF121F1E76426A00665E5C4479674322D4F75EDADD46DEBD5CD992F6ED"), BigInt("0x198E9393920D483A7260BFB731FB5D25F1AA493335A9E71297E485B7AEF312C2")],
        G2y: [BigInt("0x12C85EA5DB8C6DEB4AAB71808DCB408FE3D1E7690C43D37B4CE6CC0166FA7DAA"), BigInt("0x90689D0585FF075EC9E99AD690C3395BC4B313370B38EF355ACDADCD122975B")]

    },
    [CurveId.BLS12_381]: {
        cairoZeroNamespaceName: "bls",
        curveId: CurveId.BLS12_381,
        p: BigInt("0x1A0111EA397FE69A4B1BA7B6434BACD764774B84F38512BF6730D2A0F6B0F6241EABFFFEB153FFFFB9FEFFFFFFFFAAAB"),
        n: BigInt("0x73EDA753299D7D483339D80809A1D80553BDA402FFFE5BFEFFFFFFFF00000001"),
        x: -BigInt("0xD201000000010000"),
        h: BigInt("0x396C8C005555E1568C00AAAB0000AAAB"),
        irreduciblePolys: {
            6: [2, 0, 0, -2, 0, 0, 1],
            12: [2, 0, 0, 0, 0, 0, -2, 0, 0, 0, 0, 0, 1],
        },
        nrA0: BigInt(1),
        nrA1: BigInt(1),
        a: BigInt(0),
        b: BigInt(4),
        b20: BigInt(4),
        b21: BigInt(4),
        loopCounter: BigInt("0xD201000000010000").toString(2).slice(0).split("").reverse().map(x => parseInt(x, 10)),
        lineFunctionSparcity: [1, 0, 1, 2, 0, 0, 1, 0, 1, 0, 0, 0],
        finalExpCofactor: BigInt(3),
        fpGenerator: BigInt(3),
        Gx: BigInt("0x17F1D3A73197D7942695638C4FA9AC0FC3688C4F9774B905A14E3A3F171BAC586C55E83FF97A1AEFFB3AF00ADB22C6BB"),
        Gy: BigInt("0x08B3F481E3AAA0F1A09E30ED741D8AE4FCF5E095D5D00AF600DB18CB2C04B3EDD03CC744A2888AE40CAA232946C5E7E1"),
        G2x: [
            BigInt("0x24AA2B2F08F0A91260805272DC51051C6E47AD4FA403B02B4510B647AE3D1770BAC0326A805BBEFD48056C8C121BDB8"),
            BigInt("0x13E02B6052719F607DACD3A088274F65596BD0D09920B61AB5DA61BBDC7F5049334CF11213945D57E5AC7D055D042B7E")
        ],
        G2y: [
            BigInt("0xCE5D527727D6E118CC9CDC6DA2E351AADFD9BAA8CBDD3A76D429A695160D12C923AC9CC3BACA289E193548608B82801"),
            BigInt("0x606C4A02EA734CC32ACD2B02BC28B99CB3E287E85A763AF267492AB572E99AB3F370D275CEC1DA1AAA9075FF05F79BE")
        ]
    },
    [CurveId.SECP256K1]: {
        cairoZeroNamespaceName: "secp256r1",
        curveId: CurveId.SECP256K1,
        p: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F"),
        n: BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141"),
        h: BigInt(1),
        a: BigInt(0),
        b: BigInt(7),
        fpGenerator: BigInt(2),
        Gx: BigInt("0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798"),
        Gy: BigInt("0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8")
    },
    [CurveId.SECP256R1]: {
        cairoZeroNamespaceName: "secp256r1",
        curveId: CurveId.SECP256R1,
        p: BigInt("0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF"),
        n: BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551"),
        h: BigInt(1),
        a: BigInt("0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC"),
        b: BigInt("0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B"),
        fpGenerator: BigInt(6),
        Gx: BigInt("0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296"),
        Gy: BigInt("0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5")
    },
    [CurveId.ED25519]: {
        cairoZeroNamespaceName: "ED25519",
        curveId: CurveId.ED25519,
        p: BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFED"),
        n: BigInt("0x1000000000000000000000000000000014DEF9DEA2F79CD65812631A5CF5D3ED"),
        h: BigInt(8),
        dTwisted: BigInt("0x52036CEE2B6FFE738CC740797779E89800700A4D4141D8AB75EB4DCA135978A3"),
        aTwisted: BigInt("0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEC"),
        fpGenerator: BigInt(6),
        Gx: BigInt("0x216936D3CD6E53FEC0A4E231FDD6DC5C692CC7609525A7B2C9562D608F25D51A"),
        Gy: BigInt("0x6666666666666666666666666666666666666666666666666666666666666658")
    }
}

export const parseGroth16VerifyingKeyFromObject = (data: any): Groth16VerifyingKey => {

    try {
        const curveId = tryGuessingCurveIdFromJson(data);
        let verifyingKey: any;

        try {
            verifyingKey = findItemFromKeyPatterns(data, ["verifying_key"])
        } catch (err) {
            verifyingKey = data;
        }

        try {
            const alpha = tryParseG1PointFromKey(verifyingKey, ['alpha'], curveId);
            const beta = tryParseG2PointFromKey(verifyingKey, ['beta'], curveId);
            const gamma = tryParseG2PointFromKey(verifyingKey, ['gamma'], curveId);
            const delta = tryParseG2PointFromKey(verifyingKey, ['delta'], curveId);
            if (curveId !== null && curveId !== undefined) {


                const ic: G1Point[] = findItemFromKeyPatterns(verifyingKey, ['ic']).map((point: any) => {
                    const g1Point = tryParseG1Point(point, curveId)
                    return g1Point;
                });

                const vk: Groth16VerifyingKey = {
                    alpha,
                    beta,
                    gamma,
                    delta,
                    ic
                }


                if (checkGroth16VerifyingKey(vk)) {
                    return vk;
                }
                throw new Error(`Invalid Groth16 verifying key: ${vk}`);
            }
            throw new Error("Curve ID not provided");

        } catch (err) {
            // Gnark case
            const g1Points = findItemFromKeyPatterns(verifyingKey, ['g1']);
            const g2Points = findItemFromKeyPatterns(verifyingKey, ['g2']);

            const alpha = tryParseG1PointFromKey(g1Points, ['alpha'], curveId);
            const beta = tryParseG2PointFromKey(g2Points, ['beta'], curveId);
            const gamma = tryParseG2PointFromKey(g2Points, ['gamma'], curveId);
            const delta = tryParseG2PointFromKey(g2Points, ['delta'], curveId);


            if (curveId !== null && curveId !== undefined) {
                const ic: G1Point[] = findItemFromKeyPatterns(g1Points, ['K']).map((point: any) => tryParseG1Point(point, curveId));
                const vk = {
                    alpha,
                    beta,
                    gamma,
                    delta,
                    ic
                }

                if (checkGroth16VerifyingKey(vk)) {
                    return vk;
                }
            }
            throw new Error("Curve ID not provided");

        }

    } catch (err) {
        throw new Error(`Failed to parse Groth16 verifying key from object: ${err}`);
    }
}

export const parseGroth16ProofFromObject = (data: any, publicInputsData?: bigint[] | object): Groth16Proof => {
    try {

        let curveId = tryGuessingCurveIdFromJson(data);

        let proof: any = null;

        try {
            proof = findItemFromKeyPatterns(data, ['proof']);
        } catch (err) {
            proof = data
        }

        let publicInputs: bigint[] = [];

        if (publicInputsData && publicInputsData !== null && publicInputsData !== undefined) {

            if (typeof publicInputsData === 'object' && !Array.isArray(publicInputsData)) {
                // If it's an object, convert it to a list (array) of its values
                publicInputs = Object.values(publicInputsData).map(
                    (value: any) => toBigInt(value)
                );
            } else if (Array.isArray(publicInputsData)) {
                publicInputs = publicInputsData.map((value: any) => toBigInt(value));
            } else {
                throw new Error(`Invalid public inputs format: ${publicInputsData}`);
            }
        } else {

            try {
                publicInputs = findItemFromKeyPatterns(data, ['public']);
            } catch (err) {

            }
        }
        const a = tryParseG1PointFromKey(proof, ['a', 'Ar'], curveId);
        const b = tryParseG2PointFromKey(proof, ['b', 'Bs'], curveId);
        const c = tryParseG1PointFromKey(proof, ['c', 'Krs'], curveId);

        const returnProof = {
            a,
            b,
            c,
            publicInputs: publicInputs
        }

        if (checkGroth16Proof(returnProof)) {
            return returnProof;
        }

        throw new Error(`Invalid Groth16 proof: ${returnProof}`);

    } catch (err) {
        throw new Error(`Failed to parse Groth16 proof from object: ${err}`);
    }

}

export const checkGroth16Proof = (proof: Groth16Proof): boolean => {
    return proof.a.curveId === proof.b.curveId && proof.b.curveId === proof.c.curveId;
}

export const tryGuessingCurveIdFromJson = (data: Object): CurveId | null => {
    try {
        const curveId = findValueInStringToCurveId(findItemFromKeyPatterns(data, ['curve']));
        return curveId;
    } catch (err) {

        let x: bigint | null = null;

        for (let value in iterateNestedDictToArray(data)) {
            try {
                x = toBigInt(value);
                break;
            } catch (err) {
                continue;
            }
        }

        if (x == null || x == undefined) {
            throw new Error("No integer found in the JSON data.");
        }

        if (bitLength(x) > 256) {
            return CurveId.BLS12_381;
        } else {
            return CurveId.BN254;
        }
    }
}

const tryParseG1PointFromKey = (data: any, keyPatterns: string[], curveId: CurveId | null): G1Point => {
    const point = findItemFromKeyPatterns(data, keyPatterns);
    if (curveId === null || curveId === undefined) {
        throw new Error("Curve ID not provided");
    }
    return tryParseG1Point(point, curveId);
}

const tryParseG1Point = (point: any, curveId: CurveId): G1Point => {

    if (typeof point === "object" && !Array.isArray(point)) {
        const x = toBigInt(findItemFromKeyPatterns(point, ["x"]))
        const y = toBigInt(findItemFromKeyPatterns(point, ["y"]))
        return {
            x,
            y,
            curveId
        }
    } else if (Array.isArray(point)) {
        if (point.length == 2) {
            return {
                x: toBigInt(point[0]),
                y: toBigInt(point[1]),
                curveId
            }
        } else if (point.length == 3) {
            return projToAffine(point[0], point[1], point[2], curveId);
        }

        throw new Error(`Invalid point: ${point}`);
    } else {
        throw new Error(`Invalid point: ${point}`);
    }
}

const projToAffine = (x: string | number | bigint | Uint8Array, y: string | number | bigint | Uint8Array,
    z: string | number | bigint | Uint8Array, curveId: CurveId): G1Point => {

    let xBigInt = toBigInt(x);
    let yBigInt = toBigInt(y);
    let zBigInt = toBigInt(z);

    const p = getPFromCurveId(curveId);

    zBigInt = modInverse(zBigInt, p);
    xBigInt = xBigInt * zBigInt % p;
    yBigInt = yBigInt * zBigInt % p;

    return {
        x: xBigInt,
        y: yBigInt,
        curveId
    }


}

const getPFromCurveId = (curveId: CurveId): bigint => {
    return CURVES[curveId].p;
}


const tryParseG2PointFromKey = (data: any, keyPatterns: string[], curveId: CurveId | null): G2Point => {
    const point = findItemFromKeyPatterns(data, keyPatterns);
    if (curveId === null || curveId === undefined) {
        throw new Error("Curve ID not provided");
    }
    return tryParseG2Point(point, curveId);
}

const tryParseG2Point = (point: any, curveId: CurveId): G2Point => {
    if (typeof point === "object" && !Array.isArray(point)) {
        const xG2 = findItemFromKeyPatterns(point, ["x"]);
        const yG2 = findItemFromKeyPatterns(point, ["y"]);

        if (typeof xG2 === "object" && typeof yG2 === "object" && !Array.isArray(xG2) && !Array.isArray(yG2)) {
            return {
                x: [
                    toBigInt(findItemFromKeyPatterns(xG2, ["a0"])),
                    toBigInt(findItemFromKeyPatterns(xG2, ["a1"]))
                ],
                y: [
                    toBigInt(findItemFromKeyPatterns(yG2, ["a0"])),
                    toBigInt(findItemFromKeyPatterns(yG2, ["a1"]))
                ],
                curveId: curveId
            };
        } else if (Array.isArray(xG2) && Array.isArray(yG2)) {
            return {
                x: [toBigInt(xG2[0]), toBigInt(xG2[1])],
                y: [toBigInt(yG2[0]), toBigInt(yG2[1])],
                curveId: curveId
            };
        } else {
            throw new Error(`Invalid point: ${point}`);
        }
    } else if (Array.isArray(point)) {
        let supposedX, supposedY;

        if (point.length === 2) {
            supposedX = point[0];
            supposedY = point[1];
        } else if (point.length === 3) {
            const check = [
                toBigInt(point[2][0]),
                toBigInt(point[2][1])
            ];
            if (check[0] !== 1n || check[1] !== 0n) {
                throw new Error("Non standard projective coordinates");
            }
            supposedX = point[0];
            supposedY = point[1];
        }

        if (Array.isArray(supposedX)) {
            if (supposedX.length !== 2) {
                throw new Error(`Invalid fp2 coordinates: ${supposedX}`);
            }
            supposedX = [toBigInt(supposedX[0]), toBigInt(supposedX[1])];
        }
        if (Array.isArray(supposedY)) {
            if (supposedY.length !== 2) {
                throw new Error(`Invalid fp2 coordinates: ${supposedY}`);
            }
            supposedY = [toBigInt(supposedY[0]), toBigInt(supposedY[1])];
        }

        return {
            x: supposedX,
            y: supposedY,
            curveId: curveId
        };
    } else {
        throw new Error(`Invalid point: ${point}`);
    }
}


const findValueInStringToCurveId = (s: string): CurveId | null => {
    // Find the value of the Curve ID in the string

    if (s.toLowerCase() === "bn128") {
        return CurveId.BN254;
    }
    if (s.toLowerCase() === "bls12381") {
        return CurveId.BLS12_381;
    }

    let curveId: CurveId | null = null;

    Object.entries(CurveId).forEach(([key]) => {
        if (s.toLowerCase().includes(key.toLowerCase()) || key.toLowerCase().includes(s.toLowerCase())) {
            curveId = CurveId[key as keyof typeof CurveId];
            return;
        }
    });
    return curveId;

}

const iterateNestedDictToArray = (d: any): any[] => {
    const result: any[] = [];
    for (const key in d) {
        if (Object.prototype.hasOwnProperty.call(d, key)) {
            const value = d[key];
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                // Recursively collect values from nested objects
                result.push(...iterateNestedDictToArray(value));
            } else {
                // Add the value to the result array
                result.push(value);
            }
        }
    }
    return result;
}

const checkGroth16VerifyingKey = (vk: Groth16VerifyingKey): boolean => {
    if (vk.ic.length <= 1) {
        return false;
    }

    //check if ic points are different
    for (let i = 0; i < vk.ic.length; i++) {
        for (let j = i + 1; j < vk.ic.length; j++) {
            if (vk.ic[i]?.x === vk.ic[j]?.x && vk.ic[i]?.y === vk.ic[j]?.y && vk.ic[i]?.curveId === vk.ic[j]?.curveId) {
                return false;
            }
        }
        if (vk.ic[i]?.curveId !== vk.alpha.curveId) {
            return false;
        }
    }
    return vk.alpha.curveId === vk.beta.curveId && vk.beta.curveId === vk.gamma.curveId && vk.gamma.curveId === vk.delta.curveId;

}


const findItemFromKeyPatterns = (data: { [key: string]: any }, keyPatterns: string[]): any => {
    let bestMatch = null;
    let bestScore = -1;

    let bestMatchFound: boolean = false;


    Object.keys(data).forEach(key => {
        keyPatterns.forEach(pattern => {
            if (key.toLowerCase() == pattern.toLowerCase()) {
                bestMatch = data[key];
                bestMatchFound = true;
            }
            else if (!bestMatchFound && key.trim().toLowerCase().includes(pattern.trim().toLowerCase())) {
                //count number of matching character
                const re = new RegExp(pattern.toLowerCase(), 'g');
                const occurences = key.toLowerCase().match(re);
                const score = occurences ? occurences.length : 0;

                if (score > bestScore) {
                    bestScore = score;
                    bestMatch = data[key];
                }
            }
        });
    });

    if (bestMatch !== null) {
        return bestMatch;
    }
    throw new KeyPatternNotFoundError(`No key found with patterns ${keyPatterns}`);
}

export const toBigInt = (value: string | bigint | number | Uint8Array): bigint => {
    //Convert a string or integer to an integer. Supports hexadecimal and decimal strings.

    if (typeof value === 'string') {
        value = value.trim();
        try {
            return BigInt(value);
        } catch (e) {
            if (value.toLowerCase().startsWith('0x')) {
                throw new Error(`Invalid hexadecimal value: ${value}`);
            } else {
                throw new Error(`Invalid decimal value: ${value}`);
            }
        }
    } else if (typeof value === 'bigint') {
        return value;
    } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
            return BigInt(value);
        } else {
            throw new TypeError(`Expected integer number, got non-integer number: ${value}`);
        }
    } else if (value instanceof Uint8Array) {
        let result = BigInt(0);
        for (const byte of value) {
            result = (result << 8n) + BigInt(byte);
        }
        return result;
    } else {
        throw new TypeError(
            `Expected string, number, or Uint8Array, got ${typeof value}`
        );
    }
}

export const bitLength = (x: bigint): number => {
    if (x === 0n || x === -0n) {
        return 0;
    }
    let bits = 0;
    let n = x < 0n ? -x : x; // Handle negative numbers
    while (n > 0n) {
        n >>= 1n;
        bits++;
    }
    return bits;
}

export const modInverse = (a: bigint, p: bigint): bigint => {
    let m0 = p;
    let y = BigInt(0), x = BigInt(1);

    if (p === BigInt(1)) {
        return BigInt(0);
    }

    while (a > BigInt(1)) {
        // q is quotient
        let q = a / p;
        let t = p;

        // p is remainder now, process same as Euclid's algorithm
        p = a % p;
        a = t;
        t = y;

        // Update x and y
        y = x - q * y;
        x = t;
    }

    // Make x positive
    if (x < BigInt(0)) {
        x = x + m0;
    }

    return x;
}


export class KeyPatternNotFoundError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "KeyPatternNotFoundError";
    }
}

export async function generateCalldata(
  proofJson: any,
  publicInputsJson: any,
  vkJson: any
): Promise<string[]> {
  await garaga.init();

  const proof = parseGroth16ProofFromObject(proofJson, publicInputsJson);

  const vk = parseGroth16VerifyingKeyFromObject(vkJson);
  
  // getGroth16CallData outputs bigint[]
  const result = garaga.getGroth16CallData(
    proof as any,
    vk as any,
    vk.alpha.curveId as unknown as garaga.CurveId
  );
  return result.map((x: bigint) => x.toString());
}

export async function generateNoirCalldata(
  proofBase64: string,
  publicInputsBase64: string,
  vkBase64: string
): Promise<string[]> {
  await garaga.init();

  const proof = Buffer.from(proofBase64, 'base64');
  const publicInputs = Buffer.from(publicInputsBase64, 'base64');
  const vk = Buffer.from(vkBase64, 'base64');

  const result = garaga.getZKHonkCallData(
    new Uint8Array(proof),
    new Uint8Array(publicInputs),
    new Uint8Array(vk)
  );
  
  return result.map((x: bigint) => x.toString());
}
