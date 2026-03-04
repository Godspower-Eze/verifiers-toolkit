// Set GARAGA_PATH before module load — GARAGA_CLI_PATH is evaluated immediately
// at module scope, so it must be present before require() is called.
process.env.GARAGA_PATH = '/fake/garaga';

jest.mock('child_process', () => ({ execFile: jest.fn() }));

import { execFile } from 'child_process';

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

function simulateExecFailure(stdout: string) {
  mockExecFile.mockImplementation((_cmd, _args, _opts, callback: any) => {
    const err = Object.assign(new Error('Command failed'), { stdout, stderr: '' });
    callback(err, stdout, '');
    return {} as any;
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NoirVerifierGenerator.generate — garaga error handling', () => {
  // Import after env + mock are set up
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NoirVerifierGenerator } = require('@/lib/verifier/VerifierGenerator');
  const generator = new NoirVerifierGenerator();
  const vkBase64 = Buffer.from('fake-vk-bytes').toString('base64');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns user-friendly error when circuit has no public inputs', async () => {
    simulateExecFailure(
      '\nError: An error occurred while generating the verifier:\n' +
      'AssertionError\n' +
      '    assert len(public_inputs) > 0\n'
    );

    const result = await generator.generate(vkBase64, 'test_verifier');

    expect(result.success).toBe(false);
    expect(result.error).toContain('no public inputs');
    expect(result.error).toContain('pub');
  });

  it('returns user-friendly error when public inputs offset is invalid', async () => {
    simulateExecFailure(
      '\nError: An error occurred while generating the verifier:\n' +
      'AssertionError: invalid public inputs offset: 784708384346669040921556\n'
    );

    const result = await generator.generate(vkBase64, 'test_verifier');

    expect(result.success).toBe(false);
    expect(result.error).toContain('public inputs offset could not be parsed');
    expect(result.error).toContain('bb write_vk');
  });

  it('returns generic error for unknown garaga failures', async () => {
    simulateExecFailure('\nError: some unknown garaga failure\n');

    const result = await generator.generate(vkBase64, 'test_verifier');

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to generate verifier');
  });
});
