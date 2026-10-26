package servers

import (
	"encoding/json"
	"fmt"
	"strings"
)

const privateKeyCredentialPrefix = "serverui:private-key:v1:"

type privateKeyCredential struct {
	PrivateKey string `json:"privateKey"`
	Passphrase string `json:"passphrase"`
}

// encodePrivateKeyCredential packages the key and its passphrase before the
// existing credential cipher encrypts the complete payload.
func encodePrivateKeyCredential(key, passphrase string) (string, error) {
	payload, err := json.Marshal(privateKeyCredential{PrivateKey: key, Passphrase: passphrase})
	if err != nil {
		return "", fmt.Errorf("unable to store credentials")
	}
	return privateKeyCredentialPrefix + string(payload), nil
}

// decodePrivateKeyCredential accepts legacy credentials that stored the key
// directly, while decoding the versioned payload for encrypted keys.
func decodePrivateKeyCredential(secret string) (key, passphrase string, err error) {
	if !strings.HasPrefix(secret, privateKeyCredentialPrefix) {
		return secret, "", nil
	}
	var payload privateKeyCredential
	if err := json.Unmarshal([]byte(strings.TrimPrefix(secret, privateKeyCredentialPrefix)), &payload); err != nil {
		return "", "", fmt.Errorf("invalid private key credential")
	}
	if strings.TrimSpace(payload.PrivateKey) == "" || payload.Passphrase == "" {
		return "", "", fmt.Errorf("invalid private key credential")
	}
	return payload.PrivateKey, payload.Passphrase, nil
}
