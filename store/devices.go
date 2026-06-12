package store

import "database/sql"

type Device struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt int64  `json:"created_at"`
	LastSeen  int64  `json:"last_seen"`
}

func (s *Store) CreateDevice(name string) (*Device, error) {
	d := &Device{ID: s.NewID(), Name: name, CreatedAt: nowMs(), LastSeen: nowMs()}
	_, err := s.writeDB.Exec(
		"INSERT INTO devices (id, name, created_at, last_seen) VALUES (?,?,?,?)",
		d.ID, d.Name, d.CreatedAt, d.LastSeen)
	if err != nil {
		return nil, err
	}
	return d, nil
}

func (s *Store) GetDevice(id string) (*Device, error) {
	var d Device
	err := s.readDB.QueryRow("SELECT id, name, created_at, last_seen FROM devices WHERE id = ?", id).
		Scan(&d.ID, &d.Name, &d.CreatedAt, &d.LastSeen)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &d, nil
}

func (s *Store) ListDevices() ([]Device, error) {
	rows, err := s.readDB.Query("SELECT id, name, created_at, last_seen FROM devices ORDER BY last_seen DESC")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Device{}
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.ID, &d.Name, &d.CreatedAt, &d.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) RenameDevice(id, name string) error {
	res, err := s.writeDB.Exec("UPDATE devices SET name = ? WHERE id = ?", name, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

// DeleteDevice removes the device record; its messages keep their device_id
// and are untouched.
func (s *Store) DeleteDevice(id string) error {
	_, err := s.writeDB.Exec("DELETE FROM devices WHERE id = ?", id)
	return err
}

func (s *Store) TouchDevice(id string) error {
	_, err := s.writeDB.Exec("UPDATE devices SET last_seen = ? WHERE id = ?", nowMs(), id)
	return err
}
