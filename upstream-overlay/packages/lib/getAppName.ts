export default (isDesktop: boolean, isDev: boolean) => {
	let appName = isDev ? 'dotnotesdev' : 'dotnotes';
	if (isDesktop) appName += '-desktop';
	return appName;
};
