package api

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"golang.org/x/crypto/ssh"

	"serverui/server/internal/archive"
	"serverui/server/internal/crypto"
	"serverui/server/internal/filesystem"
	"serverui/server/internal/metrics"
	"serverui/server/internal/servers"
	sshx "serverui/server/internal/ssh"
	"serverui/server/internal/terminal"
)

func testAPI(t *testing.T) http.Handler {
	t.Helper()
	// Web/API tests expect no desktop local-auth gate.
	t.Setenv("SERVERUI_LOCAL_AUTH_TOKEN", "")
	key, err := crypto.RandomKey()
	if err != nil {
		t.Fatal(err)
	}
	box, err := crypto.New(key)
	if err != nil {
		t.Fatal(err)
	}
	svc := servers.NewService(servers.NewMemoryStore(), box)
	svc.SetDialer(func(cfg sshx.Config, auth sshx.AuthMethod) error {
		return nil
	})
	pool := svc.Pool()
	files := filesystem.New(pool)
	return New(svc, metrics.NewCollector(pool), files, archive.New(pool, files.List), terminal.New(pool)).Handler()
}

func TestServerCRUDHidesCredentials(t *testing.T) {
	handler := testAPI(t)
	body := `{
		"name":"Production",
		"host":"203.0.113.10",
		"port":22,
		"username":"deploy",
		"authType":"password",
		"password":"super-secret"
	}`
	req := httptest.NewRequest(http.MethodPost, "/api/servers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status %d %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "super-secret") {
		t.Fatal("create leaked password")
	}
	var created map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	id, _ := created["id"].(string)
	if id == "" {
		t.Fatal("missing id")
	}
	if _, ok := created["password"]; ok {
		t.Fatal("password field present")
	}
	if _, ok := created["privateKey"]; ok {
		t.Fatal("privateKey field present")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/servers", nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list %d", rec.Code)
	}
	if strings.Contains(rec.Body.String(), "super-secret") {
		t.Fatal("list leaked password")
	}

	req = httptest.NewRequest(http.MethodGet, "/api/servers/"+id, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("get %d", rec.Code)
	}

	update := `{"name":"Prod","host":"203.0.113.10","port":22,"username":"deploy","authType":"password"}`
	req = httptest.NewRequest(http.MethodPut, "/api/servers/"+id, strings.NewReader(update))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update %d %s", rec.Code, rec.Body.String())
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/servers/"+id, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("delete %d", rec.Code)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/servers/"+id, nil)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("deleted get %d", rec.Code)
	}
}

func TestServerIconRoundTripHidesFileReference(t *testing.T) {
	t.Setenv("SERVERUI_LOCAL_AUTH_TOKEN", "")
	key, err := crypto.RandomKey()
	if err != nil {
		t.Fatal(err)
	}
	box, err := crypto.New(key)
	if err != nil {
		t.Fatal(err)
	}
	svc := servers.NewService(servers.NewMemoryStore(), box)
	svc.SetIconDir(t.TempDir())
	svc.SetDialer(func(cfg sshx.Config, auth sshx.AuthMethod) error { return nil })
	pool := svc.Pool()
	files := filesystem.New(pool)
	handler := New(svc, metrics.NewCollector(pool), files, archive.New(pool, files.List), terminal.New(pool)).Handler()

	png := "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
	body := `{
		"name":"Lab","host":"203.0.113.10","port":22,"username":"deploy",
		"authType":"password","password":"secret","iconId":"storage","iconImage":"` + png + `"
	}`
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/servers", strings.NewReader(body)))
	if rec.Code != http.StatusCreated {
		t.Fatalf("create %d %s", rec.Code, rec.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["iconId"] != "storage" || created["customIcon"] != true {
		t.Fatalf("public icon %+v", created)
	}
	if _, ok := created["customIconPath"]; ok {
		t.Fatal("file path leaked")
	}
	if strings.Contains(rec.Body.String(), "password") && strings.Contains(rec.Body.String(), "secret") {
		t.Fatal("credential leaked")
	}
	id, _ := created["id"].(string)
	rec = httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/servers/"+id+"/icon", nil))
	if rec.Code != http.StatusOK || rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("icon %d %s", rec.Code, rec.Header().Get("Content-Type"))
	}
	if rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("cache %s", rec.Header().Get("Cache-Control"))
	}
}

func TestCreateRejectsInvalidHost(t *testing.T) {
	handler := testAPI(t)
	req := httptest.NewRequest(http.MethodPost, "/api/servers", bytes.NewBufferString(`{
		"name":"Bad","host":"not a host","port":22,"username":"u","authType":"password","password":"x"
	}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
}

func TestFilesRequireServerID(t *testing.T) {
	handler := testAPI(t)
	req := httptest.NewRequest(http.MethodGet, "/api/files?path=/", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d %s", rec.Code, rec.Body.String())
	}
}

func TestTestConnectionDraftDoesNotSave(t *testing.T) {
	handler := testAPI(t)
	body := `{"host":"203.0.113.10","port":22,"username":"deploy","authType":"password","password":"super-secret"}`
	req := httptest.NewRequest(http.MethodPost, "/api/servers/test-connection", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var result struct {
		OK bool `json:"ok"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &result); err != nil || !result.OK {
		t.Fatalf("result %s (%v)", rec.Body.String(), err)
	}
	if strings.Contains(rec.Body.String(), "super-secret") {
		t.Fatal("response leaked the password")
	}

	list := httptest.NewRecorder()
	handler.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/servers", nil))
	if !strings.Contains(list.Body.String(), `"servers":[]`) {
		t.Fatalf("draft test saved a server: %s", list.Body.String())
	}
}

func TestTestConnectionDraftRejectsInvalidHost(t *testing.T) {
	handler := testAPI(t)
	body := `{"host":"not a host","port":22,"username":"deploy","authType":"password","password":"x"}`
	req := httptest.NewRequest(http.MethodPost, "/api/servers/test-connection", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
}

func TestValidatePrivateKeyEndpointDetectsPassphraseWithoutDialing(t *testing.T) {
	handler := testAPI(t)
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	block, err := ssh.MarshalPrivateKeyWithPassphrase(key, "", []byte("correct horse"))
	if err != nil {
		t.Fatal(err)
	}
	privateKey := string(pem.EncodeToMemory(block))

	request := func(passphrase string) *httptest.ResponseRecorder {
		body, err := json.Marshal(map[string]string{
			"privateKey": privateKey,
			"privateKeyPassphrase": passphrase,
		})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodPost, "/api/servers/validate-private-key", bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		return rec
	}

	missing := request("")
	var missingResult map[string]any
	if err := json.Unmarshal(missing.Body.Bytes(), &missingResult); err != nil {
		t.Fatal(err)
	}
	if missing.Code != http.StatusOK || missingResult["code"] != sshx.CodePassphraseRequired || missingResult["ok"] != false {
		t.Fatalf("missing passphrase response: status=%d body=%s", missing.Code, missing.Body.String())
	}

	wrong := request("wrong")
	var wrongResult map[string]any
	if err := json.Unmarshal(wrong.Body.Bytes(), &wrongResult); err != nil {
		t.Fatal(err)
	}
	if wrongResult["code"] != sshx.CodePassphraseInvalid {
		t.Fatalf("wrong passphrase response: %s", wrong.Body.String())
	}

	correct := request("correct horse")
	var correctResult map[string]any
	if err := json.Unmarshal(correct.Body.Bytes(), &correctResult); err != nil {
		t.Fatal(err)
	}
	if correct.Code != http.StatusOK || correctResult["ok"] != true {
		t.Fatalf("correct passphrase response: status=%d body=%s", correct.Code, correct.Body.String())
	}
}
