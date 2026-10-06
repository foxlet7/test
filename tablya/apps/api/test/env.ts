// Loaded before every test file (jest setupFiles).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://tablya:tablya_dev@localhost:5432/tablya_test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-test-access-secret-1234';
process.env.DATA_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-0123456789';
process.env.PAYMENT_PROVIDER = 'sandbox';
process.env.EXPOSE_DEV_OTP = 'true';
process.env.THROTTLE_LIMIT = '100000';
process.env.AUTH_THROTTLE_LIMIT = '100000';
process.env.STORAGE_DIR = require('path').join(require('os').tmpdir(), 'tablya-test-uploads');
process.env.TAX_BPS = '1500';
process.env.SERVICE_FEE_BPS = '0';
process.env.DEFAULT_COMMISSION_BPS = '1500';
