import {
  ADAPTIVE_DROPPABLE_PARAMS,
  classifyUpstreamError,
  detectUnsupportedParameter,
  parseErrorEnvelope,
  requestIncludesImage,
} from './openai-error-classifier';

// -----------------------------------------------------------------------------
// Fixtures
//
// Every body below is the shape OpenAI actually returns for that condition,
// down to the punctuation, because the whole point of this module is to read
// them. Where a field has been observed as null it is null here.
// -----------------------------------------------------------------------------

const INVALID_KEY = JSON.stringify({
  error: {
    message:
      'Incorrect API key provided: sk-live-**********9999. You can find your API key at https://platform.openai.com/account/api-keys.',
    type: 'invalid_request_error',
    param: null,
    code: 'invalid_api_key',
  },
});

const MODEL_NOT_FOUND = JSON.stringify({
  error: {
    message:
      "The model 'gpt-5.4-nano' does not exist or you do not have access to it.",
    type: 'invalid_request_error',
    param: null,
    code: 'model_not_found',
  },
});

const NO_IMAGE_SUPPORT = JSON.stringify({
  error: {
    message: 'Invalid content type. image_url is only supported by certain models.',
    type: 'invalid_request_error',
    param: 'messages[1].content[1].type',
    code: 'invalid_value',
  },
});

const NO_STRUCTURED_OUTPUT = JSON.stringify({
  error: {
    message:
      "Invalid parameter: 'response_format' of type 'json_schema' is not supported with this model.",
    type: 'invalid_request_error',
    param: 'response_format',
    code: null,
  },
});

const TEMPERATURE_UNSUPPORTED = JSON.stringify({
  error: {
    message:
      "Unsupported value: 'temperature' does not support 0 with this model. Only the default (1) is supported.",
    type: 'invalid_request_error',
    param: 'temperature',
    code: 'unsupported_value',
  },
});

const MAX_TOKENS_UNSUPPORTED = JSON.stringify({
  error: {
    message:
      "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    type: 'invalid_request_error',
    param: 'max_tokens',
    code: 'unsupported_parameter',
  },
});

/** Observed with `param: null` and `code: null` - only the prose identifies it. */
const UNRECOGNIZED_ARGUMENT = JSON.stringify({
  error: {
    message: 'Unrecognized request argument supplied: temperature',
    type: 'invalid_request_error',
    param: null,
    code: null,
  },
});

const INSUFFICIENT_QUOTA = JSON.stringify({
  error: {
    message:
      'You exceeded your current quota, please check your plan and billing details.',
    type: 'insufficient_quota',
    param: null,
    code: 'insufficient_quota',
  },
});

const RATE_LIMITED = JSON.stringify({
  error: {
    message:
      'Rate limit reached for gpt-4o-mini in organization org-abc on requests per min (RPM): Limit 3, Used 3, Requested 1.',
    type: 'requests',
    param: null,
    code: 'rate_limit_exceeded',
  },
});

const IMAGE_REQUEST_BODY: Record<string, unknown> = {
  model: 'some-model',
  temperature: 0,
  messages: [
    { role: 'system', content: 'be helpful' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'read this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
      ],
    },
  ],
  response_format: { type: 'json_schema' },
};

const classify = (status: number, body: string, withImage = true) =>
  classifyUpstreamError(status, parseErrorEnvelope(body), withImage);

// -----------------------------------------------------------------------------

describe('parseErrorEnvelope', () => {
  it('flattens a well-formed error object', () => {
    expect(parseErrorEnvelope(MODEL_NOT_FOUND)).toEqual({
      message:
        "The model 'gpt-5.4-nano' does not exist or you do not have access to it.",
      type: 'invalid_request_error',
      param: null,
      code: 'model_not_found',
    });
  });

  it('survives a body that is not JSON at all', () => {
    // A proxy or gateway in front of the API can return HTML.
    expect(parseErrorEnvelope('<html>502 Bad Gateway</html>')).toEqual({
      message: '',
      type: null,
      code: null,
      param: null,
    });
  });

  it('survives JSON whose `error` is a bare string', () => {
    expect(parseErrorEnvelope('{"error":"slow down"}').message).toBe('');
  });

  it('survives an empty body', () => {
    expect(parseErrorEnvelope('').code).toBeNull();
  });
});

describe('classifyUpstreamError', () => {
  describe('credential', () => {
    it.each([401, 403])('treats %s as auth', (status) => {
      expect(classify(status, INVALID_KEY)).toBe('auth');
    });

    it('treats an invalid_api_key code as auth whatever the status', () => {
      expect(classify(400, INVALID_KEY)).toBe('auth');
    });
  });

  describe('throttling', () => {
    it('separates a spent quota from a rate limit', () => {
      expect(classify(429, INSUFFICIENT_QUOTA)).toBe('quota');
      expect(classify(429, RATE_LIMITED)).toBe('rate_limited');
    });

    it('does not mistake "Rate limit reached ... Limit 3" for a quota problem', () => {
      // The rate-limit prose contains the word "Limit"; the quota test must not
      // fire on it, or a transient throttle would be reported as "you are out
      // of credit" and send an admin to the billing page for nothing.
      expect(classify(429, RATE_LIMITED)).not.toBe('quota');
    });
  });

  it('treats 5xx as unavailable', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classify(status, '{}')).toBe('unavailable');
    }
  });

  describe('model name vs model capability - the distinction this exists for', () => {
    it('reads a 404 model_not_found as model_not_found', () => {
      expect(classify(404, MODEL_NOT_FOUND)).toBe('model_not_found');
    });

    it('reads a bare 404 with no usable body as model_not_found', () => {
      expect(classify(404, '')).toBe('model_not_found');
    });

    it('reads an image-content rejection as model_no_image_support', () => {
      expect(classify(400, NO_IMAGE_SUPPORT)).toBe('model_no_image_support');
    });

    it('reads a response_format rejection as model_no_structured_output', () => {
      expect(classify(400, NO_STRUCTURED_OUTPUT)).toBe(
        'model_no_structured_output',
      );
    });

    it('never blames image support when the request carried no image', () => {
      expect(classify(400, NO_IMAGE_SUPPORT, false)).toBe('bad_request');
    });

    it('checks the model name before any capability, so a typo is not misreported', () => {
      // A body that would match BOTH the model-not-found and the image rules.
      // An unknown model cannot have told us anything about its capabilities,
      // so the name must win.
      const both = JSON.stringify({
        error: {
          message:
            "The model 'typo-4o' does not exist or you do not have access to it. image_url is only supported by certain models.",
          type: 'invalid_request_error',
          param: null,
          code: 'model_not_found',
        },
      });
      expect(classify(400, both)).toBe('model_not_found');
    });
  });

  describe('honest fallback', () => {
    it('returns bad_request for a 400 it does not recognise', () => {
      expect(classify(400, '{"error":{"message":"upstream"}}')).toBe(
        'bad_request',
      );
    });

    it('returns bad_request for a 400 with an unparseable body', () => {
      expect(classify(400, 'not json')).toBe('bad_request');
    });

    it('classifies a temperature rejection as bad_request, not as a capability failure', () => {
      // Load-bearing: only `bad_request` is eligible for the adaptive retry.
      // If this were classified as a capability failure the retry would never
      // fire and every extraction on such a model would fail.
      expect(classify(400, TEMPERATURE_UNSUPPORTED)).toBe('bad_request');
    });
  });
});

describe('detectUnsupportedParameter', () => {
  const detect = (status: number, body: string, requestBody = IMAGE_REQUEST_BODY) =>
    detectUnsupportedParameter(status, parseErrorEnvelope(body), requestBody);

  it('names temperature from the `param` field', () => {
    expect(detect(400, TEMPERATURE_UNSUPPORTED)).toBe('temperature');
  });

  it('names temperature from the message when `param` and `code` are null', () => {
    expect(detect(400, UNRECOGNIZED_ARGUMENT)).toBe('temperature');
  });

  it('names max_tokens when that is what was sent', () => {
    expect(
      detect(400, MAX_TOKENS_UNSUPPORTED, {
        ...IMAGE_REQUEST_BODY,
        max_tokens: 400,
      }),
    ).toBe('max_tokens');
  });

  it('refuses to name a parameter we did not send', () => {
    // The body complains about max_tokens but our request had none. Dropping
    // something we never sent would achieve nothing and the retry must not run.
    expect(detect(400, MAX_TOKENS_UNSUPPORTED)).toBeNull();
  });

  it('never names response_format, however the error is phrased', () => {
    // Dropping response_format would turn a schema-validated extraction into
    // free text - a silent data-integrity change, not a compatibility fix.
    expect(detect(400, NO_STRUCTURED_OUTPUT)).toBeNull();
    expect(ADAPTIVE_DROPPABLE_PARAMS.has('response_format')).toBe(false);
  });

  it('never names model or messages', () => {
    expect(ADAPTIVE_DROPPABLE_PARAMS.has('model')).toBe(false);
    expect(ADAPTIVE_DROPPABLE_PARAMS.has('messages')).toBe(false);
    expect(detect(400, NO_IMAGE_SUPPORT)).toBeNull();
  });

  it.each([401, 403, 404, 429, 500, 502])(
    'refuses to detect anything on a %s',
    (status) => {
      // A parameter complaint is always a 400. Allowing any other status here
      // would let the retry fire on a genuine auth or quota failure.
      expect(detect(status, TEMPERATURE_UNSUPPORTED)).toBeNull();
    },
  );

  it('returns null when nothing in the error signals unsupportedness', () => {
    const vague = JSON.stringify({
      error: {
        message: 'Something went wrong.',
        type: 'invalid_request_error',
        param: 'temperature',
        code: null,
      },
    });
    expect(detect(400, vague)).toBeNull();
  });

  it('does not branch on the model name', () => {
    // The same error must produce the same decision regardless of which model
    // was being called. No version sniffing, now or later.
    for (const model of ['gpt-4o-mini', 'gpt-5.4-nano', 'something-2031']) {
      expect(
        detect(400, TEMPERATURE_UNSUPPORTED, { ...IMAGE_REQUEST_BODY, model }),
      ).toBe('temperature');
    }
  });
});

describe('requestIncludesImage', () => {
  it('finds an image_url part', () => {
    expect(requestIncludesImage(IMAGE_REQUEST_BODY)).toBe(true);
  });

  it('is false for a text-only request', () => {
    expect(
      requestIncludesImage({
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    ).toBe(false);
  });

  it('is false for a plain-string content request', () => {
    expect(
      requestIncludesImage({ messages: [{ role: 'user', content: 'hi' }] }),
    ).toBe(false);
  });

  it('is false for a body with no messages', () => {
    expect(requestIncludesImage({})).toBe(false);
    expect(requestIncludesImage(null)).toBe(false);
  });
});
