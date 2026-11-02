import * as React from 'react';
import Svg, { SvgProps, Path } from 'react-native-svg';

// Original generic cloud illustration for the derivative app.
const JoplinCloudIcon: React.FC<SvgProps> = props => <Svg viewBox='0 0 84 84' {...props}>
  <Path fill='#315E56' d='M20 62C1 62 1 35 20 34C24 9 59 9 64 34C85 35 84 62 64 62Z'/>
</Svg>;
export default JoplinCloudIcon;
