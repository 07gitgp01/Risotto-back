import { buildPasswordResetMessage } from './mail.service';

describe('buildPasswordResetMessage', () => {
  it('addresses the user and contains the code and its validity', () => {
    const message = buildPasswordResetMessage('alice@example.com', '042517', 30);
    expect(message.to).toBe('alice@example.com');
    expect(message.subject).toContain('réinitialisation');
    expect(message.text).toContain('042517');
    expect(message.text).toContain('30 minutes');
  });
});
