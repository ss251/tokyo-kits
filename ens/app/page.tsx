import { EnsLab } from './ens-lab';
import { ensSepolia } from '../lib/ens';

export const dynamic = 'force-dynamic';
export default function Page() {
  return <EnsLab settings={{ initialName: process.env.ENS_DEMO_NAME ?? '', chainId: 11155111,
    universalResolver: ensSepolia.contracts.ensUniversalResolver.address,
    transport: process.env.ENS_RPC_URL ? 'configured server RPC' : 'public RPC' }} />;
}
