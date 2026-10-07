import { useEffect, useMemo, useState } from 'react';
import { Card, ErrorBox, Loading, PageHeader, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth, type Level } from '../lib/auth';
import { PERM_ROLE_LABEL as ROLE_LABEL } from '../lib/codes';
import { useFetch } from '../lib/hooks';

interface MenuDef {
  key: string;
  label: string;
  group: string;
  editable: boolean;
  editDesc?: string;
}
interface Resp {
  roles: string[];
  menus: MenuDef[];
  permissions: Record<string, Record<string, Level>>;
}

const LEVEL_LABEL: Record<Level, string> = { NONE: '없음', VIEW: '조회', EDIT: '편집' };

/** 메뉴 권한: 역할 × 메뉴 → 없음/조회/편집 (시스템관리자 전용) */
export default function Permissions() {
  const toast = useToast();
  const { reloadPerms } = useAuth();
  const { data, error, setData } = useFetch<Resp>('/admin/permissions');
  const [f, setF] = useState<Resp['permissions'] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (data) setF(structuredClone(data.permissions));
  }, [data]);

  const changed = useMemo(() => {
    if (!data || !f) return 0;
    return data.roles.reduce((n, r) => n + data.menus.filter((m) => f[r][m.key] !== data.permissions[r][m.key]).length, 0);
  }, [data, f]);

  const set = (role: string, menu: string, level: Level) => setF((s) => (s ? { ...s, [role]: { ...s[role], [menu]: level } } : s));

  const save = async () => {
    if (!f) return;
    setBusy(true);
    try {
      setData(await api.put<Resp>('/admin/permissions', f));
      reloadPerms(); // 내 메뉴도 바로 반영
      toast('메뉴 권한을 저장했습니다. 다른 사용자는 화면을 새로 열면 반영됩니다.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const groups = data ? [...new Set(data.menus.map((m) => m.group))] : [];

  return (
    <div>
      <PageHeader
        title="메뉴 권한"
        desc={
          <>
            역할별로 메뉴마다 <b>없음 · 조회 · 편집</b>을 정합니다. 메뉴 표시, 화면 접근, 서버 API가 모두 이 설정을 따릅니다. '프로젝트 PM' 열은 투입 배정에서 PM으로 지정된 수행인력에게 추가로 적용되며, 담당 프로젝트 범위만 봅니다. 일반 수행인력은 본인 데이터만 봅니다. 시스템관리자 계정·역할 변경과 이 화면은 시스템관리자 전용입니다.
          </>
        }
        actions={
          <div className="row">
            {changed > 0 && <span className="small muted">변경 {changed}건</span>}
            <button className="btn" disabled={!changed || busy} onClick={() => data && setF(structuredClone(data.permissions))}>
              되돌리기
            </button>
            <button className="btn primary" disabled={!changed || busy} onClick={save}>
              저장
            </button>
          </div>
        }
      />
      <ErrorBox error={error} />
      {!data || !f ? (
        <Loading />
      ) : (
        <Card>
          <div className="table-wrap">
            <table className="tbl perm-tbl">
              <thead>
                <tr>
                  <th>메뉴</th>
                  {data.roles.map((r) => (
                    <th key={r} className="center">
                      {ROLE_LABEL[r]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  <tr key={g} className="perm-group">
                    <td colSpan={data.roles.length + 1}>{g}</td>
                  </tr>,
                  ...data.menus
                    .filter((m) => m.group === g)
                    .map((m) => (
                      <tr key={m.key}>
                        <td>
                          <strong>{m.label}</strong>
                          <div className="small muted">{m.editable ? `편집: ${m.editDesc}` : '조회 전용 화면'}</div>
                        </td>
                        {data.roles.map((r) => {
                          const v = f[r][m.key];
                          const dirty = v !== data.permissions[r][m.key];
                          return (
                            <td key={r} className="center">
                              <select
                                value={v}
                                onChange={(e) => set(r, m.key, e.target.value as Level)}
                                className={`perm-sel ${v} ${dirty ? 'dirty' : ''}`}
                                aria-label={`${ROLE_LABEL[r]} · ${m.label}`}
                              >
                                {(m.editable ? (['NONE', 'VIEW', 'EDIT'] as Level[]) : (['NONE', 'VIEW'] as Level[])).map((l) => (
                                  <option key={l} value={l}>
                                    {LEVEL_LABEL[l]}
                                  </option>
                                ))}
                              </select>
                            </td>
                          );
                        })}
                      </tr>
                    )),
                ])}
                <tr className="perm-group">
                  <td colSpan={data.roles.length + 1}>시스템</td>
                </tr>
                <tr>
                  <td>
                    <strong>메뉴 권한</strong>
                    <div className="small muted">이 화면 (변경 불가)</div>
                  </td>
                  {data.roles.map((r) => (
                    <td key={r} className="center small muted">
                      {r === 'ADMIN' ? '편집 (고정)' : '없음'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
