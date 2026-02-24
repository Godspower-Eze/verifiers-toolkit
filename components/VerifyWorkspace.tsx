'use client';

export default function VerifyWorkspace() {
  return (
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      textAlign: 'center',
      background: '#0f172a',
    }}>
      <h1 style={{ fontSize: 28, fontWeight: 700, color: '#f1f5f9', marginBottom: 16, letterSpacing: '-0.02em' }}>
        Verify Proof
      </h1>
      <p style={{ color: '#94a3b8', maxWidth: 480, lineHeight: 1.6 }}>
        Upload your proof and public inputs to verify against a deployed Starknet Verifier contract.
      </p>
      <p style={{ color: '#475569', marginTop: 16, fontSize: 13 }}>Coming soon</p>
    </div>
  );
}
