<?php
/**
 * Per-trade notes, stored on the server so they follow you between devices.
 *
 * WHY THIS EXISTS
 *   Notes were localStorage: written on the laptop, invisible on the phone.
 *   Kumar wants to write a note from either and have it be the same note.
 *
 * WHY THERE IS NO AUTH CODE IN THIS FILE
 *   Access control is the .htaccess next to it. Apache checks that BEFORE this
 *   script runs, so a password prompt written here would be theatre -- and a
 *   token embedded in the page's JavaScript would be readable by anyone who
 *   opens view-source.
 *
 *   This means the file is only as private as that .htaccess. If Basic Auth is
 *   not set up, this endpoint is world-writable. Read SETUP in the .htaccess
 *   before deploying.
 *
 * STORAGE
 *   notes.json, right here. Deliberately NOT merged into journal.json: that
 *   file is overwritten by the nightly job every day, and a merge would mean
 *   one bad upload erases every note ever written. Separate files, separate
 *   blast radius.
 *
 * API
 *   GET                       -> {"notes": {key: text, ...}}
 *   POST {key, text}          -> {"ok": true, "saved": key}
 *   Key format: date:time:instrument, e.g. "2026-08-03:13:27:NIFTY24500CE"
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$FILE      = __DIR__ . '/notes.json';
$MAX_NOTE  = 4000;      // one note
$MAX_TOTAL = 1500000;   // whole file, ~1.5 MB. A runaway writer fills a disk.
$MAX_KEYS  = 5000;

function out($data, $code = 200) {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function load($file) {
    if (!file_exists($file)) return [];
    $raw = file_get_contents($file);
    if ($raw === false || $raw === '') return [];
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    out(['notes' => load($FILE)]);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    out(['error' => 'Use GET to read or POST to save.'], 405);
}

$body = json_decode(file_get_contents('php://input'), true);
if (!is_array($body) || !isset($body['key'])) {
    out(['error' => 'Send JSON with a "key" and a "text".'], 400);
}

$key  = (string) $body['key'];
$text = isset($body['text']) ? (string) $body['text'] : '';

// The key names a trade, nothing else. Anything outside this alphabet could be
// a path, and a path could write somewhere other than notes.json.
if (!preg_match('/^[A-Za-z0-9:_.\-]{5,120}$/', $key)) {
    out(['error' => 'Bad key.'], 400);
}
if (strlen($text) > $MAX_NOTE) {
    out(['error' => "Note too long (max $MAX_NOTE characters)."], 413);
}

// Lock for the whole read-modify-write. Two devices saving at the same moment
// would otherwise each write their own copy of the file and one note would
// vanish with nothing to show it ever existed.
$fp = fopen($FILE, 'c+');
if ($fp === false) {
    out(['error' => 'Cannot open notes.json — check file permissions (needs 644 and a writable folder).'], 500);
}
if (!flock($fp, LOCK_EX)) {
    fclose($fp);
    out(['error' => 'Could not lock notes.json.'], 500);
}

$raw   = stream_get_contents($fp);
$notes = $raw ? (json_decode($raw, true) ?: []) : [];

if ($text === '') {
    unset($notes[$key]);                       // empty box means delete
} else {
    if (!isset($notes[$key]) && count($notes) >= $MAX_KEYS) {
        flock($fp, LOCK_UN); fclose($fp);
        out(['error' => 'Too many notes stored.'], 507);
    }
    $notes[$key] = $text;
}

$encoded = json_encode($notes, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
if (strlen($encoded) > $MAX_TOTAL) {
    flock($fp, LOCK_UN); fclose($fp);
    out(['error' => 'Notes file is full.'], 507);
}

ftruncate($fp, 0);
rewind($fp);
$written = fwrite($fp, $encoded);
fflush($fp);
flock($fp, LOCK_UN);
fclose($fp);

if ($written === false) {
    out(['error' => 'Write failed.'], 500);
}
out(['ok' => true, 'saved' => $key, 'count' => count($notes)]);
