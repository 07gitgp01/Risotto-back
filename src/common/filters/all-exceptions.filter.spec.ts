import { ArgumentsHost, BadRequestException, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function mockHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  beforeAll(() => {
    jest.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  it('keeps the status and validation messages of HTTP exceptions', () => {
    const { host, status, json } = mockHost();
    filter.catch(new BadRequestException(['email must be an email']), host);
    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['email must be an email'],
      error: 'Bad Request',
    });
  });

  it('handles exceptions without a custom payload', () => {
    const { host, status, json } = mockHost();
    filter.catch(new NotFoundException(), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json.mock.calls[0][0]).toMatchObject({ statusCode: 404 });
  });

  it('keeps the status of exposed client errors from Express middlewares', () => {
    const { host, status, json } = mockHost();
    const tooLarge = Object.assign(new Error('request entity too large: limit 102400'), {
      status: 413,
      expose: true,
    });
    filter.catch(tooLarge, host);
    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith({
      statusCode: 413,
      message: 'Payload too large',
      error: 'Payload Too Large',
    });
  });

  it('hides the details of unexpected errors', () => {
    const { host, status, json } = mockHost();
    filter.catch(new Error('connection string postgres://user:pwd@db leaked'), host);
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    });
  });

  it('does not trust a 5xx or unexposed status', () => {
    const { host, status } = mockHost();
    filter.catch(Object.assign(new Error('x'), { status: 503, expose: true }), host);
    filter.catch(Object.assign(new Error('y'), { status: 400, expose: false }), host);
    expect(status).toHaveBeenNthCalledWith(1, 500);
    expect(status).toHaveBeenNthCalledWith(2, 500);
  });
});
