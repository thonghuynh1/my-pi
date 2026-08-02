declare function $state<T>(value: T): T;
declare const $derived: {
	<T>(value: T): T;
	by<T>(factory: () => T): T;
};
