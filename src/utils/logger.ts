import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({ level: env.LOG_LEVEL, redact: ['req.headers.authorization', '*.access_token', '*.refresh_token', '*.bookingReference'] }, pino.destination(2));
