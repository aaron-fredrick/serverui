package sshx

import (
	"errors"
	"testing"
)

func TestClassifyError(t *testing.T) {
	cases := map[string]string{
		"dial tcp: lookup nope.invalid: no such host":                                                                        CodeInvalidHost,
		"dial tcp 203.0.113.10:22: connect: connection refused":                                                              CodeConnectionRefused,
		"dial tcp 203.0.113.10:22: i/o timeout":                                                                              CodeTimeout,
		"dial tcp 10.0.0.9:22: connect: no route to host":                                                                    CodeUnreachable,
		"dial tcp 10.0.0.9:22: connect: network is unreachable":                                                              CodeUnreachable,
		"ssh: handshake failed: read tcp 1.2.3.4:5->6.7.8.9:22: read: connection reset by peer":                              CodeConnectionReset,
		"ssh: handshake failed: EOF":                                                                                         CodeNotSSH,
		"ssh: overflow reading version string":                                                                               CodeNotSSH,
		"ssh: handshake failed: ssh: unable to authenticate, attempted methods [none password], no supported methods remain": CodeAuthFailed,
		"ssh: handshake failed: read tcp 1.2.3.4:5->6.7.8.9:22: i/o timeout":                                                 CodeTimeout,
		"invalid private key": CodeInvalidPrivateKey,
		"passphrase required": CodePassphraseRequired,
		"invalid passphrase": CodePassphraseInvalid,
		"something unexpected": CodeSSHFailed,
	}
	for raw, want := range cases {
		code, message := ClassifyError(errors.New(raw))
		if code != want {
			t.Errorf("ClassifyError(%q) = %q, want %q", raw, code, want)
		}
		if message == "" {
			t.Errorf("ClassifyError(%q) returned no message", raw)
		}
	}
	if code, message := ClassifyError(nil); code != "" || message != "" {
		t.Fatalf("nil error classified as %q %q", code, message)
	}
}
