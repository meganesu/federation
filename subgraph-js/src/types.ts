import {
  GraphQLFieldConfig,
  GraphQLString,
  GraphQLUnionType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLNonNull,
  GraphQLList,
  GraphQLType,
  GraphQLNamedType,
  isNamedType,
  isObjectType,
} from 'graphql';
import { PromiseOrValue } from 'graphql/jsutils/PromiseOrValue';
import type { CacheHint } from 'apollo-server-types';
import { hasReferenceResolver } from './schemaExtensions';

export type Maybe<T> = null | undefined | T;

export const EntityType = new GraphQLUnionType({
  name: '_Entity',
  types: [],
});

export const ServiceType = new GraphQLObjectType({
  name: '_Service',
  fields: {
    sdl: {
      type: GraphQLString,
      description:
        'The sdl representing the federated service capabilities. Includes federation directives, removes federation types, and includes rest of full schema after schema directives have been applied',
    },
  },
});

export const AnyType = new GraphQLScalarType({
  name: '_Any',
  serialize(value) {
    return value;
  },
});

function isPromise<T>(value: PromiseOrValue<T>): value is Promise<T> {
  return Boolean(value && 'then' in value && typeof value.then === 'function');
}

function addTypeNameToPossibleReturn<T>(
  maybeObject: null | T,
  typename: string,
): null | (T & { __typename: string }) {
  if (maybeObject !== null && typeof maybeObject === 'object') {
    Object.defineProperty(maybeObject, '__typename', {
      value: typename,
    });
  }
  return maybeObject as null | (T & { __typename: string });
}

export const entitiesField: GraphQLFieldConfig<any, any> = {
  type: new GraphQLNonNull(new GraphQLList(EntityType)),
  args: {
    representations: {
      type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(AnyType))),
    },
  },
  resolve(_source, { representations }, context, info) {
    return representations.map((reference: { __typename: string } & object) => {
      const { __typename } = reference;

      const type = info.schema.getType(__typename);
      if (!type || !isObjectType(type)) {
        throw new Error(
          `The _entities resolver tried to load an entity for type "${__typename}", but no object type of that name was found in the schema`,
        );
      }

      // Note that while our TypeScript types (as of apollo-server-types@3.0.2)
      // tell us that cacheControl and restrict are always defined, we want to
      // avoid throwing when used with Apollo Server 2 which doesn't have
      // `restrict`, or if the cache control plugin has been disabled.
      if (info.cacheControl?.cacheHint?.restrict) {
        const cacheHint: CacheHint | undefined =
          info.cacheControl.cacheHintFromType(type);

        if (cacheHint) {
          info.cacheControl.cacheHint.restrict(cacheHint);
        }
      }

      const resolveReference = hasReferenceResolver(type)
        ? type.resolveReference!
        : function defaultResolveReference() {
            return reference;
          };

      // FIXME somehow get this to show up special in Studio traces?
      const result = resolveReference(reference, context, info);

      if (isPromise(result)) {
        return result.then((x: any) =>
          addTypeNameToPossibleReturn(x, __typename),
        );
      }

      return addTypeNameToPossibleReturn(result, __typename);
    });
  },
};

export const serviceField: GraphQLFieldConfig<any, any> = {
  type: new GraphQLNonNull(ServiceType),
};

export const federationTypes: GraphQLNamedType[] = [
  ServiceType,
  AnyType,
  EntityType,
];

export function isFederationType(type: GraphQLType): boolean {
  return (
    isNamedType(type) && federationTypes.some(({ name }) => name === type.name)
  );
}
