// Minimal NextResponse mock for API route unit tests.
// Keeps the same interface used by the route handlers.

export function createNextResponseMock() {
    return {
        json: jest.fn((data: any, init?: { status?: number }) => ({
            status: init?.status ?? 200,
            _data: data,
            json: async () => data,
        })),
        redirect: jest.fn((url: string) => ({
            status: 302,
            _url: url,
            headers: { get: (k: string) => (k === 'location' ? url : null) },
        })),
    };
}

export function makeRequest(method: string, body?: any, headers: Record<string, string> = {}): Request {
    return new Request('http://localhost:3888/api/test', {
        method,
        headers: { 'Content-Type': 'application/json', ...headers },
        body: body ? JSON.stringify(body) : undefined,
    });
}
