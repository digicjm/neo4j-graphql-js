import { RelationshipDirectionField } from './relationship';
import { buildNodeOutputFields } from './query';
import { shouldAugmentRelationshipField } from '../../augment';
import { OperationType } from '../../types/types';
import { TypeWrappers, getFieldDefinition } from '../../fields';
import {
  DirectiveDefinition,
  buildAuthScopeDirective,
  buildMutationMetaDirective,
  buildRelationDirective,
  useAuthDirective,
  getDirective,
  isCypherField
} from '../../directives';
import {
  buildInputValue,
  buildName,
  buildNamedType,
  buildField,
  buildObjectType,
  buildInputObjectType
} from '../../ast';

/**
 * An enum describing the names of relationship mutations,
 * for node and relationship type fields (field and type
 * relation directive)
 */
export const RelationshipMutation = {
  CREATE: 'Add',
  DELETE: 'Remove'
};

/**
 * Given the results of augmentRelationshipTypeFields, builds or
 * augments the AST definitions of the Mutation operation fields
 * and any generated input or output types required for translation
 */
export const augmentRelationshipMutationAPI = ({
  typeName,
  fieldName,
  outputType,
  fromType,
  toType,
  relationshipName,
  propertyInputValues = [],
  propertyOutputFields = [],
  typeDefinitionMap,
  generatedTypeMap,
  operationTypeMap,
  config
}) => {
  const mutationTypeName = OperationType.MUTATION;
  const mutationType = operationTypeMap[mutationTypeName];
  const mutationTypeNameLower = mutationTypeName.toLowerCase();
  if (
    mutationType &&
    shouldAugmentRelationshipField(
      config,
      mutationTypeNameLower,
      fromType,
      toType
    )
  ) {
    Object.values(RelationshipMutation).forEach(mutationAction => {
      const mutationName = buildRelationshipMutationName({
        mutationAction,
        typeName,
        fieldName
      });
      if (
        !getFieldDefinition({
          fields: mutationType.fields,
          name: mutationName
        })
      ) {
        [operationTypeMap, generatedTypeMap] = buildRelationshipMutationAPI({
          mutationAction,
          mutationName,
          relationshipName,
          fromType,
          toType,
          propertyInputValues,
          propertyOutputFields,
          outputType,
          generatedTypeMap,
          operationTypeMap,
          config
        });
      }
    });
  }
  return [typeDefinitionMap, generatedTypeMap, operationTypeMap];
};

/**
 * Builds the AST for the input value definitions used as
 * field arguments on relationship mutations for selecting
 * the related nodes
 */
const buildNodeSelectionArguments = ({ fromType, toType }) => {
  return [
    buildInputValue({
      name: buildName({
        name: RelationshipDirectionField.FROM
      }),
      type: buildNamedType({
        name: `_${fromType}Input`,
        wrappers: {
          [TypeWrappers.NON_NULL_NAMED_TYPE]: true
        }
      })
    }),
    buildInputValue({
      name: buildName({
        name: RelationshipDirectionField.TO
      }),
      type: buildNamedType({
        name: `_${toType}Input`,
        wrappers: {
          [TypeWrappers.NON_NULL_NAMED_TYPE]: true
        }
      })
    })
  ];
};

/**
 * Builds the AST definitions decided and configured in
 * augmentRelationshipMutationAPI
 */
const buildRelationshipMutationAPI = ({
  mutationAction,
  mutationName,
  relationshipName,
  fromType,
  toType,
  propertyInputValues,
  propertyOutputFields,
  outputType,
  generatedTypeMap,
  operationTypeMap,
  config
}) => {
  const mutationOutputType = `_${mutationName}Payload`;
  operationTypeMap = buildRelationshipMutationField({
    mutationAction,
    mutationName,
    relationshipName,
    fromType,
    toType,
    propertyOutputFields,
    mutationOutputType,
    outputType,
    operationTypeMap,
    config
  });
  generatedTypeMap = buildRelationshipMutationPropertyInputType({
    mutationAction,
    outputType,
    propertyInputValues,
    generatedTypeMap
  });
  generatedTypeMap = buildRelationshipMutationOutputType({
    mutationAction,
    mutationOutputType,
    propertyOutputFields,
    relationshipName,
    fromType,
    toType,
    generatedTypeMap
  });
  return [operationTypeMap, generatedTypeMap];
};

/**
 * Builds the AST definition for a Mutation operation field
 * of a given RelationshipMutation name
 */
const buildRelationshipMutationField = ({
  mutationAction,
  mutationName,
  relationshipName,
  fromType,
  toType,
  propertyOutputFields,
  mutationOutputType,
  outputType,
  operationTypeMap,
  config
}) => {
  if (
    mutationAction === RelationshipMutation.CREATE ||
    mutationAction === RelationshipMutation.DELETE
  ) {
    operationTypeMap[OperationType.MUTATION].fields.push(
      buildField({
        name: buildName({
          name: mutationName
        }),
        type: buildNamedType({
          name: mutationOutputType
        }),
        args: buildRelationshipMutationArguments({
          mutationAction,
          fromType,
          toType,
          propertyOutputFields,
          outputType
        }),
        directives: buildRelationshipMutationDirectives({
          mutationAction,
          relationshipName,
          fromType,
          toType,
          propertyOutputFields,
          config
        })
      })
    );
  }
  return operationTypeMap;
};

/**
 * Given the use of a relationship type field, builds the AST
 * for the input value definition of the 'data' argument for its 'Add'
 * relationship mutation field, which inputs a generated input object
 * type for providing relationship properties
 */
const buildRelationshipPropertyInputArgument = ({ outputType }) => {
  return buildInputValue({
    name: buildName({ name: 'data' }),
    type: buildNamedType({
      name: `_${outputType}Input`,
      wrappers: {
        [TypeWrappers.NON_NULL_NAMED_TYPE]: true
      }
    })
  });
};

/**
 * Builds the AST for the relationship type property input
 * object definition, used as the type of the 'data' input value
 * definition built by buildRelationshipPropertyInputArgument
 */
const buildRelationshipMutationPropertyInputType = ({
  mutationAction,
  outputType,
  propertyInputValues,
  generatedTypeMap
}) => {
  if (
    mutationAction === RelationshipMutation.CREATE &&
    propertyInputValues.length
  ) {
    let nonComputedPropertyInputFields = propertyInputValues.filter(field => {
      const cypherDirective = getDirective({
        directives: field.directives,
        name: DirectiveDefinition.CYPHER
      });
      return !cypherDirective;
    });
    const inputTypeName = `_${outputType}Input`;
    generatedTypeMap[inputTypeName] = buildInputObjectType({
      name: buildName({ name: inputTypeName }),
      fields: nonComputedPropertyInputFields.map(inputValue =>
        buildInputValue({
          name: buildName({ name: inputValue.name }),
          type: buildNamedType(inputValue.type)
        })
      )
    });
  }
  return generatedTypeMap;
};

/**
 * Builds the AST for the input value definitions used as arguments on
 * generated relationship Mutation fields of RelationshipMutation names
 */
const buildRelationshipMutationArguments = ({
  mutationAction,
  fromType,
  toType,
  propertyOutputFields,
  outputType
}) => {
  const fieldArguments = buildNodeSelectionArguments({ fromType, toType });
  if (
    mutationAction === RelationshipMutation.CREATE &&
    propertyOutputFields.length
  ) {
    fieldArguments.push(
      buildRelationshipPropertyInputArgument({
        outputType
      })
    );
  }
  return fieldArguments;
};

/**
 * Builds the AST definitions for directive instances used by
 * generated relationship Mutation fields of RelationshipMutation
 * names
 */
const buildRelationshipMutationDirectives = ({
  mutationAction,
  relationshipName,
  fromType,
  toType,
  propertyOutputFields,
  config
}) => {
  const mutationMetaDirective = buildMutationMetaDirective({
    relationshipName,
    fromType,
    toType
  });
  const directives = [mutationMetaDirective];
  if (useAuthDirective(config, DirectiveDefinition.HAS_SCOPE)) {
    let authAction = '';
    if (mutationAction === RelationshipMutation.CREATE) {
      authAction = 'Create';
    } else if (mutationAction === RelationshipMutation.DELETE) {
      authAction = 'Delete';
    }
    if (authAction) {
      directives.push(
        buildAuthScopeDirective({
          scopes: [
            {
              typeName: fromType,
              mutation: authAction
            },
            {
              typeName: toType,
              mutation: authAction
            }
          ]
        })
      );
    }
  }
  return directives;
};

/**
 * Builds the AST for the object type definition used for the
 * output type of relationship type Mutation fields
 */
const buildRelationshipMutationOutputType = ({
  mutationAction,
  mutationOutputType,
  propertyOutputFields,
  relationshipName,
  fromType,
  toType,
  generatedTypeMap
}) => {
  if (
    mutationAction === RelationshipMutation.CREATE ||
    mutationAction === RelationshipMutation.DELETE
  ) {
    const relationTypeDirective = buildRelationDirective({
      relationshipName,
      fromType,
      toType
    });
    let fields = buildNodeOutputFields({ fromType, toType });
    if (mutationAction === RelationshipMutation.CREATE) {
      // TODO temporary block on cypher field arguments - needs translation test
      const mutationOutputFields = propertyOutputFields.map(field => {
        if (isCypherField({ directives: field.directives })) {
          return {
            ...field,
            arguments: []
          };
        } else return field;
      });
      fields.push(...mutationOutputFields);
    }
    generatedTypeMap[mutationOutputType] = buildObjectType({
      name: buildName({ name: mutationOutputType }),
      fields,
      directives: [relationTypeDirective]
    });
  }
  return generatedTypeMap;
};

/**
 * Builds the full name value for a relationship mutation field
 */
const buildRelationshipMutationName = ({
  mutationAction,
  typeName,
  fieldName
}) =>
  `${mutationAction}${typeName}${fieldName[0].toUpperCase() +
    fieldName.substr(1)}`;
