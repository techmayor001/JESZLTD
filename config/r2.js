// config/r2.config.js
const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_BUCKET     = process.env.R2_BUCKET || 'lecture-slides';
const R2_ENDPOINT   = `https://${CF_ACCOUNT_ID}.r2.cloudflarestorage.com`;

// Normalise public base — strip trailing slashes, ensure https:// prefix
const _rawBase   = (process.env.R2_PUBLIC_BASE || '').trim().replace(/\/+$/, '');
const R2_PUBLIC_BASE = _rawBase.startsWith('http') ? _rawBase : `https://${_rawBase}`;

const r2 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY, secretAccessKey: R2_SECRET_KEY },
    forcePathStyle: true,
});

/**
 * Extract an R2 object key from a public URL.
 * e.g. "https://assets.techmayorco.com/slides/abc.pdf" → "slides/abc.pdf"
 */
function r2KeyFromUrl(url) {
    if (!url || !url.startsWith('http')) return null;
    try {
        return new URL(url).pathname.replace(/^\//, '') || null;
    } catch {
        return null;
    }
}

/**
 * Delete a single R2 object by its public URL.
 * Best-effort — never throws.
 */
async function deleteR2Object(url) {
    const key = r2KeyFromUrl(url);
    if (!key) return;
    try {
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
        console.log(`[R2] Deleted: ${key}`);
    } catch (err) {
        console.warn(`[R2] Could not delete ${key}:`, err.message);
    }
}

module.exports = {
    r2,
    R2_BUCKET,
    R2_PUBLIC_BASE,
    r2KeyFromUrl,
    deleteR2Object,
};