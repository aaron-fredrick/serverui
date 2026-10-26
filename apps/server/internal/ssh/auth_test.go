package sshx

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/pem"
	"errors"
	"testing"

	"golang.org/x/crypto/ssh"
)

func TestParsePrivateKeyAuth(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	block := &pem.Block{Type: "RSA PRIVATE KEY", Bytes: marshalPKCS1(key)}
	pemBytes := pem.EncodeToMemory(block)
	auth, err := ParsePrivateKeyAuth(string(pemBytes), "")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := auth.(PublicKeyAuth); !ok {
		t.Fatal("expected public key auth")
	}
}

func TestParsePrivateKeyAuthRejectsEmpty(t *testing.T) {
	if _, err := ParsePrivateKeyAuth("", ""); err == nil {
		t.Fatal("expected error")
	}
}

func TestParsePrivateKeyAuthPassphraseProtected(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(key, "", []byte("correct horse"))
	if err != nil {
		t.Fatal(err)
	}
	pemBytes := pem.EncodeToMemory(block)

	if _, err := ParsePrivateKeyAuth(string(pemBytes), ""); !errors.Is(err, ErrPassphraseRequired) {
		t.Fatalf("missing passphrase error = %v", err)
	}
	if _, err := ParsePrivateKeyAuth(string(pemBytes), "wrong"); !errors.Is(err, ErrInvalidPassphrase) {
		t.Fatalf("wrong passphrase error = %v", err)
	}
	auth, err := ParsePrivateKeyAuth(string(pemBytes), "correct horse")
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := auth.(PublicKeyAuth); !ok {
		t.Fatalf("auth = %#v, want PublicKeyAuth", auth)
	}
}

func marshalPKCS1(key *rsa.PrivateKey) []byte {
	return rsaPKCS1(key)
}
