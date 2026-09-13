import { publicConfig } from './_server/config';
import { WorldLab } from './world-lab';
export const dynamic = 'force-dynamic';
export default function Page() { return <WorldLab config={publicConfig()} />; }
