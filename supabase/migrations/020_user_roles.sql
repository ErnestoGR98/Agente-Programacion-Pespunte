-- ============================================================
-- 020: Roles de usuario (admin / usuario)
-- ============================================================
-- admin   = acceso total al sistema (todas las vistas y acciones)
-- usuario = solo Planeador de tiempos y Catalogo (lectura)
-- ============================================================

-- 1. Enum de roles
DO $$ BEGIN
  CREATE TYPE user_rol AS ENUM ('admin', 'usuario');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Tabla profiles (1:1 con auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  rol        user_rol NOT NULL DEFAULT 'usuario',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Helper is_admin() — SECURITY DEFINER bypasa RLS para evitar recursion
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND rol = 'admin'
  );
$$;

-- 4. Trigger: crear profile con rol 'usuario' al hacer signup
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO profiles (id, rol) VALUES (NEW.id, 'usuario')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 5. RLS en profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Cada usuario lee su propio perfil (necesario para que el frontend sepa su rol)
DROP POLICY IF EXISTS "profiles_self_read" ON profiles;
CREATE POLICY "profiles_self_read" ON profiles
  FOR SELECT USING (auth.uid() = id);

-- Solo admin puede insertar/actualizar/eliminar perfiles
DROP POLICY IF EXISTS "profiles_admin_write" ON profiles;
CREATE POLICY "profiles_admin_write" ON profiles
  FOR ALL USING (is_admin())
  WITH CHECK (is_admin());

-- 6. Backfill: crear perfil para usuarios existentes (default 'usuario')
INSERT INTO profiles (id, rol)
SELECT id, 'usuario' FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 7. Promover al admin inicial
UPDATE profiles SET rol = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'ing.ernestogonzalezr@gmail.com');
