import { useEffect, useState } from 'react';
import { Card, Empty, ErrorBox, Field, Loading, PageHeader, useToast } from '../components/ui';
import { api, qs } from '../lib/api';
import { SETTING_LABEL } from '../lib/codes';
import { dow } from '../lib/dates';
import { useFetch } from '../lib/hooks';

export default function Settings() {
  return (
    <div>
      <PageHeader title="기준값 설정" desc="MM 환산 기준, 알림 임계값, 공휴일 캘린더를 관리합니다. 공휴일은 가용 MD·영업일 계산에 사용됩니다." />
      <div className="grid cols-2">
        <SettingsCard />
        <HolidaysCard />
      </div>
    </div>
  );
}

function SettingsCard() {
  const toast = useToast();
  const { data, error, setData } = useFetch<Record<string, string>>('/admin/settings');
  const [f, setF] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  const save = async () => {
    try {
      setData(await api.put<Record<string, string>>('/admin/settings', f));
      toast('저장했습니다.');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  return (
    <Card
      title="기준값"
      actions={
        <button className="btn sm primary" onClick={save} disabled={!data}>
          저장
        </button>
      }
    >
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : (
        <div className="form-grid">
          {Object.keys(data).map((k) => (
            <Field key={k} label={SETTING_LABEL[k] ?? k}>
              <input value={f[k] ?? ''} onChange={(e) => setF((s) => ({ ...s, [k]: e.target.value }))} />
            </Field>
          ))}
        </div>
      )}
    </Card>
  );
}

function HolidaysCard() {
  const toast = useToast();
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const { data, error, reload } = useFetch<{ dt: string; name: string }[]>(`/admin/holidays${qs({ year })}`);
  const [dt, setDt] = useState('');
  const [name, setName] = useState('');

  const add = async () => {
    try {
      await api.post('/admin/holidays', { dt, name });
      setDt('');
      setName('');
      reload();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'bad');
    }
  };
  const remove = async (d: string) => {
    await api.del(`/admin/holidays/${d}`);
    reload();
  };

  return (
    <Card
      title="공휴일 캘린더"
      actions={
        <select value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 'auto' }}>
          {[-1, 0, 1].map((n) => {
            const y = String(new Date().getFullYear() + n);
            return (
              <option key={y} value={y}>
                {y}년
              </option>
            );
          })}
        </select>
      }
    >
      <div className="row" style={{ marginBottom: 12, flexWrap: 'nowrap' }}>
        <input type="date" value={dt} onChange={(e) => setDt(e.target.value)} style={{ maxWidth: 170 }} />
        <input placeholder="명칭 (예: 대체공휴일)" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!dt || !name.trim()} onClick={add}>
          추가
        </button>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !data.length ? (
        <Empty>등록된 공휴일이 없습니다.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <tbody>
              {data.map((h) => (
                <tr key={h.dt}>
                  <td className="nowrap">
                    {h.dt} ({dow(h.dt)})
                  </td>
                  <td>{h.name}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn sm danger" onClick={() => remove(h.dt)}>
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
