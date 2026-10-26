package sshx

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/ssh"
)

var (
	ErrPassphraseRequired = errors.New("passphrase required")
	ErrInvalidPassphrase  = errors.New("invalid passphrase")
)

type AuthMethod interface {
	SSHAuthMethod() ssh.AuthMethod
}

type PasswordAuth struct {
	Password string
}

func (p PasswordAuth) SSHAuthMethod() ssh.AuthMethod {
	return ssh.Password(p.Password)
}

type PublicKeyAuth struct {
	signer ssh.Signer
}

func (p PublicKeyAuth) SSHAuthMethod() ssh.AuthMethod {
	return ssh.PublicKeys(p.signer)
}

func ParsePrivateKeyAuth(pemBytes, passphrase string) (AuthMethod, error) {
	pemBytes = strings.TrimSpace(pemBytes)
	if pemBytes == "" {
		return nil, fmt.Errorf("private key is required")
	}
	raw := []byte(pemBytes)
	signer, err := ssh.ParsePrivateKey(raw)
	if err == nil {
		return PublicKeyAuth{signer: signer}, nil
	}
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) || strings.Contains(strings.ToLower(err.Error()), "passphrase") {
		if passphrase == "" {
			return nil, ErrPassphraseRequired
		}
		signer, err = ssh.ParsePrivateKeyWithPassphrase(raw, []byte(passphrase))
		if err != nil {
			return nil, ErrInvalidPassphrase
		}
		return PublicKeyAuth{signer: signer}, nil
	}
	return nil, fmt.Errorf("invalid private key")
}
